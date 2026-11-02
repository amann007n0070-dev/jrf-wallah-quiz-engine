
import { DurableObject } from "cloudflare:workers";

const reply = (data, status = 200) =>
  Response.json(data, { status });

async function tg(env, method, payload) {
  const response = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  );

  const result = await response.json();
  if (!result.ok) throw new Error(result.description || "Telegram API error");
  return result.result;
}

const clean = value => String(value ?? "").replace(/[\r\n]/g, " ").slice(0, 200);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "GET" && path === "/health") {
      return reply({ ok: true, service: "JRF WALLAH Quiz Engine" });
    }

    if (path === "/telegram-webhook" && request.method === "POST") {
      if (
        request.headers.get("X-Telegram-Bot-Api-Secret-Token") !==
        env.TELEGRAM_WEBHOOK_SECRET
      ) {
        return new Response("Unauthorized", { status: 401 });
      }

      const update = await request.json();

      if (update.poll_answer) {
        const id = env.QUIZ_ENGINE.idFromName("jrf-wallah-main");
        const stub = env.QUIZ_ENGINE.get(id);

        await stub.fetch("https://quiz.internal/answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(update.poll_answer)
        });
      }

      return new Response("OK");
    }

    if (path.startsWith("/admin/")) {
  const auth = request.headers.get("Authorization") || "";
  if (!env.QUIZ_API_SECRET ||
      auth !== `Bearer ${env.QUIZ_API_SECRET}`) {
    return reply({ ok: false, error: "Unauthorized" }, 401);
  }

      const id = env.QUIZ_ENGINE.idFromName("jrf-wallah-main");
      const stub = env.QUIZ_ENGINE.get(id);

      if (path === "/admin/set-webhook" && request.method === "POST") {
        const result = await tg(env, "setWebhook", {
          url: `${url.origin}/telegram-webhook`,
          secret_token: env.TELEGRAM_WEBHOOK_SECRET,
          allowed_updates: ["poll_answer"],
          drop_pending_updates: false
        });
        return reply({ ok: true, webhook: result });
      }

      if (path === "/admin/schedule" && request.method === "POST") {
      const body = await request.json();
      const startAt = body.startAt;
      const title = body.title || "JRF WALLAH Soil Science Test";
      const topics = body.topics || "ICAR JRF Soil Science";
        if (!startAt || !Number.isFinite(Date.parse(startAt))) {
          return reply({ ok: false, error: "Invalid startAt date" }, 400);
        }

        const result = await stub.fetch("https://quiz.internal/schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ startAt, title, topics })
        });

        return new Response(result.body, {
          status: result.status,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (path === "/admin/status" && request.method === "GET") {
        return stub.fetch("https://quiz.internal/status");
      }

      if (path === "/admin/cancel" && request.method === "POST") {
        return stub.fetch("https://quiz.internal/cancel", { method: "POST" });
      }

      return reply({ ok: false, error: "Unknown admin route" }, 404);
    }

    return new Response("JRF WALLAH Quiz Engine");
  }
};

export class QuizEngine extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }

  async getState() {
    return (await this.ctx.storage.get("quizState")) || null;
  }

  async putState(state) {
    await this.ctx.storage.put("quizState", state);
  }

  async getQuestions() {
    const url = new URL(this.env.QUESTION_API_URL);
    url.searchParams.set("key", this.env.QUIZ_API_SECRET);

    const response = await fetch(url.toString(), { redirect: "follow" });
    if (!response.ok) throw new Error(`Question API HTTP ${response.status}`);

    const data = await response.json();

    if (!data.ok || !Array.isArray(data.questions) ||
        data.questions.length !== 50) {
      throw new Error(data.error || "Question API must return 50 questions");
    }

    return data.questions.map((q, i) => {
      if (
        typeof q.question !== "string" ||
        !Array.isArray(q.options) ||
        q.options.length !== 4 ||
        !Number.isInteger(q.answer) ||
        q.answer < 0 || q.answer > 3
      ) {
        throw new Error(`Invalid question ${i + 1}`);
      }

      return {
        question: q.question,
        options: q.options.map(String),
        answer: q.answer
      };
    });
  }

  async sendGroupMessage(text) {
    return tg(this.env, "sendMessage", {
      chat_id: this.env.GROUP_CHAT_ID,
      text
    });
  }

  async sendQuestion(state, index) {
    const q = state.questions[index];

    const message = await tg(this.env, "sendPoll", {
      chat_id: this.env.GROUP_CHAT_ID,
      question: q.question,
      options: q.options.map(text => ({ text })),
      type: "quiz",
      correct_option_id: q.answer,
      is_anonymous: false,
      open_period: 30
    });

    state.pollMap[message.poll.id] = index;
    state.currentIndex = index;
    state.lastPollMessageId = message.message_id;
    state.status = "running";

    await this.putState(state);

    // Schedule the next question 30 seconds after this poll is sent.
    await this.ctx.storage.setAlarm(Date.now() + 30000);
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/schedule" && request.method === "POST") {
      const current = await this.getState();

      if (current && ["scheduled", "running"].includes(current.status)) {
        return reply({ ok: false, error: "A quiz is already active" }, 409);
      }

      const body = await request.json();
      const startAt = Date.parse(body.startAt);

      if (!Number.isFinite(startAt) || startAt < Date.now() + 300000) {
        return reply({
          ok: false,
          error: "Choose a start time at least 5 minutes in the future"
        }, 400);
      }

      let questions;
      try {
        questions = await this.getQuestions();
      } catch (error) {
        return reply({ ok: false, error: error.message }, 500);
      }

      const state = {
        status: "scheduled",
        title: clean(body.title),
        topics: clean(body.topics),
        startAt,
        notified: false,
        questions,
        currentIndex: -1,
        lastPollId: null,
        lastPollMessageId: null,
        pollMap: {},
        users: {}
      };

      await this.putState(state);
      await this.ctx.storage.setAlarm(startAt - 300000);

      return reply({
        ok: true,
        status: "scheduled",
        questionCount: questions.length,
        notificationAt: new Date(startAt - 300000).toISOString(),
        startAt: new Date(startAt).toISOString()
      });
    }

    if (url.pathname === "/answer" && request.method === "POST") {
      const answer = await request.json();
      const state = await this.getState();

      if (!state || state.status !== "running" ||
          !answer.poll_id || !answer.user) {
        return reply({ ok: true, ignored: true });
      }

      const index = state.pollMap[answer.poll_id];

      if (index === undefined || !Array.isArray(answer.option_ids)) {
        return reply({ ok: true, ignored: true });
      }

      const userId = String(answer.user.id);
      const name = [
        answer.user.first_name,
        answer.user.last_name
      ].filter(Boolean).join(" ") || answer.user.username || userId;

      if (!state.users[userId]) {
        state.users[userId] = {
          name: clean(name),
          answers: {}
        };
      }

      // Latest answer replaces an earlier answer if the user changes it.
      state.users[userId].answers[index] =
        answer.option_ids.length ? answer.option_ids[0] : null;

      await this.putState(state);
      return reply({ ok: true });
    }

    if (url.pathname === "/status" && request.method === "GET") {
      const state = await this.getState();
      return reply({
        ok: true,
        status: state?.status || "idle",
        currentQuestion: state ? state.currentIndex + 1 : 0
      });
    }

    if (url.pathname === "/cancel" && request.method === "POST") {
      const state = await this.getState();

      if (state) {
        state.status = "cancelled";
        await this.putState(state);
      }

      await this.ctx.storage.deleteAlarm();
      return reply({ ok: true, status: "cancelled" });
    }

    return reply({ ok: false, error: "Unknown route" }, 404);
  }

  async alarm() {
    const state = await this.getState();

    if (!state || !["scheduled", "running"].includes(state.status)) return;

    try {
      if (state.status === "scheduled" && !state.notified) {
        const startTime = new Intl.DateTimeFormat("en-IN", {
          timeZone: "Asia/Kolkata",
          dateStyle: "medium",
          timeStyle: "short"
        }).format(new Date(state.startAt));

        await this.sendGroupMessage(
          `📢 JRF WALLAH TEST ALERT\n\n` +
          `${state.title}\n` +
          `Start: ${startTime} IST\n` +
          `Questions: 50\n` +
          `Time: 30 seconds per question\n\n` +
          `Topics: ${state.topics}\n\n` +
          `Be ready!`
        );

        state.notified = true;
        await this.putState(state);
        await this.ctx.storage.setAlarm(state.startAt);
        return;
      }

      if (state.status === "scheduled" && state.notified) {
        await this.sendGroupMessage(
          `🚀 ${state.title} STARTED!\n\n50 questions | 30 seconds each.\nAll the best!`
        );

        await this.sendQuestion(state, 0);
        return;
      }

      if (state.status === "running") {
        const nextIndex = state.currentIndex + 1;

        if (nextIndex < state.questions.length) {
          await this.sendQuestion(state, nextIndex);
          return;
        }

        state.status = "finished";
        await this.putState(state);
        await this.ctx.storage.deleteAlarm();
        await this.publishLeaderboard(state);
      }
    } catch (error) {
      console.error("Quiz alarm error:", error.message);

      await this.sendGroupMessage(
        "⚠️ Quiz engine error: " + clean(error.message)
      ).catch(() => null);

      await this.ctx.storage.setAlarm(Date.now() + 10000);
    }
  }

  async publishLeaderboard(state) {
    const users = Object.values(state.users).map(user => {
      let score = 0;

      for (const [index, selected] of Object.entries(user.answers)) {
        if (selected !== null &&
            selected === state.questions[Number(index)]?.answer) {
          score++;
        }
      }

      return { name: user.name, score };
    });

    users.sort((a, b) => b.score - a.score);

    const lines = users.slice(0, 10).map((user, index) =>
      `${index + 1}. ${user.name} — ${user.score}/50`
    );

    await this.sendGroupMessage(
      `🏁 ${state.title} COMPLETED!\n\n` +
      `Participants: ${users.length}\n\n` +
      `🏆 LEADERBOARD\n` +
      (lines.length ? lines.join("\n") : "No answers received.")
    );
  }
}
