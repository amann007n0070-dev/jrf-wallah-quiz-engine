
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

            const id = env.QUIZ_ENGINE.idFromName("jrf-wallah-main");
      const stub = env.QUIZ_ENGINE.get(id);

      if (update.poll_answer) {
        await stub.fetch("https://quiz.internal/answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(update.poll_answer)
        });
      }

      if (update.message) {
        await stub.fetch("https://quiz.internal/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(update.message)
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
      if (path === "/admin/questions-check" && request.method === "GET") {
  const result = await stub.fetch("https://quiz.internal/questions-check");
  return new Response(result.body, {
    status: result.status,
    headers: { "Content-Type": "application/json" }
  });
}

      if (path === "/admin/set-webhook" && request.method === "POST") {
        const result = await tg(env, "setWebhook", {
          url: `${url.origin}/telegram-webhook`,
          secret_token: env.TELEGRAM_WEBHOOK_SECRET,
          allowed_updates: ["poll_answer", "message"],
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
      if (path === "/admin/telegram-check" && request.method === "GET") {
  try {
    const token = env.BOT_TOKEN;
    const chatId = env.GROUP_CHAT_ID;

    if (!token || !chatId) {
      return Response.json({
        ok: false,
        error: "BOT_TOKEN or GROUP_CHAT_ID is missing"
      }, { status: 500 });
    }

    const base = `https://api.telegram.org/bot${token}`;

    const meResponse = await fetch(`${base}/getMe`);
    const me = await meResponse.json();

    if (!me.ok) {
      return Response.json({
        ok: false,
        step: "getMe",
        error: me.description
      }, { status: 502 });
    }

    const chatResponse = await fetch(
      `${base}/getChat?chat_id=${encodeURIComponent(chatId)}`
    );
    const chat = await chatResponse.json();

    if (!chat.ok) {
      return Response.json({
        ok: false,
        step: "getChat",
        error: chat.description
      }, { status: 502 });
    }

    const memberResponse = await fetch(
      `${base}/getChatMember?chat_id=${encodeURIComponent(chatId)}&user_id=${me.result.id}`
    );
    const member = await memberResponse.json();

    return Response.json({
      ok: me.ok && chat.ok && member.ok,
      bot: {
        username: me.result.username
      },
      group: {
        title: chat.result.title,
        type: chat.result.type
      },
      membership: member.ok
        ? { status: member.result.status }
        : { error: member.description }
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: String(error.message)
    }, { status: 500 });
  }
}
           if (path === "/admin/webhook-info" && request.method === "GET") {
        const result = await tg(env, "getWebhookInfo", {});
        return reply({
          ok: true,
          webhookUrl: result.url,
          pendingUpdates: result.pending_update_count
        });
      }

      if (path === "/admin/restore-production-webhook" && request.method === "POST") {
        const result = await tg(env, "setWebhook", {
          url: "https://jrf-wallah-telegram.amann007n0070.workers.dev/",
          secret_token: env.TELEGRAM_WEBHOOK_SECRET,
          allowed_updates: ["poll_answer", "message"],
          drop_pending_updates: false
        });

        return reply({ ok: true, restored: true, webhook: result });
      }

      if (path === "/admin/status" && request.method === "GET") {
        return stub.fetch("https://quiz.internal/status");
      }       
       if (path === "/admin/reset" && request.method === "POST") {
  return stub.fetch("https://quiz.internal/reset", { method: "POST" });
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
    if (!response.ok) {
      throw new Error(`Question API HTTP ${response.status}`);
    }

    const data = await response.json();

    if (
      !data.ok ||
      !Array.isArray(data.questions) ||
      data.questions.length !== 50
    ) {
      throw new Error(data.error || "Question API must return 50 questions");
    }

    return data.questions.map((q, i) => {
      if (
        typeof q.question !== "string" ||
        !Array.isArray(q.options) ||
        q.options.length !== 4 ||
        !Number.isInteger(q.answer) ||
        q.answer < 0 ||
        q.answer > 3
      ) {
        throw new Error(`Invalid question ${i + 1}`);
      }
             const questionLength = [...q.question].length;

      if (questionLength < 1 || questionLength > 300) {
        throw new Error(
          `Question ${i + 1} exceeds Telegram's 300-character limit (${questionLength} characters)`
        );
      }
      const options = q.options.map(option =>
        String(option).normalize("NFC").trim()
      );

      const invalidOption = options.findIndex(
        option => [...option].length === 0 || [...option].length > 80
      );

      if (invalidOption !== -1) {
        throw new Error(
          `Question ${i + 1}, option ${invalidOption + 1} is too long or empty`
        );
      }

      return {
        question: q.question,
        options,
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
    for (let i = 0; i < q.options.length; i++) {
  const option = String(q.options[i]).normalize("NFC").trim();

  if (!option || option.length > 100) {
    throw new Error(
      `Question ${index + 1}, option ${i + 1} invalid: ${option.length} characters`
    );
  }
}

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
    if (url.pathname === "/questions-check" && request.method === "GET") {
  try {
    const questions = await this.getQuestions();
    return reply({
      ok: true,
      questionCount: questions.length,
      message: "Question bank validated; no quiz started."
    });
  } catch (error) {
    return reply({
      ok: false,
      error: clean(error.message)
    }, 502);
  }
}

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
     
    if (url.pathname === "/message" && request.method === "POST") {
      const message = await request.json();
      const chatId = message.chat?.id;
      const command = (message.text || "").trim();

      if (!chatId || !command) {
        return reply({ ok: true, ignored: true });
      }
            if (
        message.chat?.type !== "private" &&
        (command === "/start" || command === "/practice")
      ) {
        return reply({ ok: true, ignored: true });
      }
      if (command === "/start") {
        await tg(this.env, "sendMessage", {
          chat_id: chatId,
          text:
            "👋 Welcome to JRF WALLAH Practice Mode!\n\n" +
"You can attempt completed quizzes here at any time.\n\n" +
"📚 Send /practice to view available quizzes."
        });
      }
      
      const practiceMatch = command.match(/^\/practice(?:@\w+)?\s+(\d+)$/);

      if (practiceMatch) {
        if (message.chat?.type !== "private" || !message.from?.id) {
          return reply({ ok: true, ignored: true });
        }

        const quizNumber = Number(practiceMatch[1]);
        const quizzes =
          (await this.ctx.storage.get("completedQuizzes")) || [];
        const quiz = quizzes[quizNumber - 1];

        if (!quiz || !Array.isArray(quiz.questions) || !quiz.questions.length) {
          await tg(this.env, "sendMessage", {
            chat_id: chatId,
            text: "This quiz is not available. Send /practice to view the quiz list."
          });
          return reply({ ok: true });
        }

        const userId = String(message.from.id);
        const sessions =
          (await this.ctx.storage.get("practiceSessions")) || {};

        if (sessions[userId]?.status === "running") {
          await tg(this.env, "sendMessage", {
            chat_id: chatId,
            text: "You already have an active practice quiz. Complete it first."
          });
          return reply({ ok: true });
        }

        const q = quiz.questions[0];

        const poll = await tg(this.env, "sendPoll", {
          chat_id: chatId,
          question: `📚 ${quiz.title}\nQ1/${quiz.questions.length}\n\n${q.question}`,
          options: q.options.map(text => ({ text })),
          type: "quiz",
          correct_option_id: q.answer,
          is_anonymous: false
        });

        sessions[userId] = {
  status: "running",
  quizId: quiz.id,
  title: quiz.title,
  questions: quiz.questions,
  currentIndex: 0,
  currentPollId: poll.poll.id,
  correct: 0,
  wrong: 0,
  unanswered: 0
};

        const practicePollMap =
          (await this.ctx.storage.get("practicePollMap")) || {};

        practicePollMap[poll.poll.id] = userId;

        await this.ctx.storage.put("practiceSessions", sessions);
        await this.ctx.storage.put("practicePollMap", practicePollMap);

        return reply({ ok: true, practiceStarted: true });
      }
      
      if (command === "/next") {
        if (message.chat?.type !== "private" || !message.from?.id) {
          return reply({ ok: true, ignored: true });
        }

        const userId = String(message.from.id);
        const sessions =
          (await this.ctx.storage.get("practiceSessions")) || {};
        const session = sessions[userId];

        if (!session || session.status !== "running") {
          await tg(this.env, "sendMessage", {
            chat_id: chatId,
            text: "You do not have an active practice quiz."
          });
          return reply({ ok: true });
        }

        const practicePollMap =
          (await this.ctx.storage.get("practicePollMap")) || {};

        if (session.currentPollId) {
          delete practicePollMap[session.currentPollId];
        }

        session.unanswered = (session.unanswered || 0) + 1;

        const nextIndex = session.currentIndex + 1;

        if (nextIndex < session.questions.length) {
          const nextQuestion = session.questions[nextIndex];

          const nextPoll = await tg(this.env, "sendPoll", {
            chat_id: chatId,
            question: nextQuestion.question,
            options: nextQuestion.options.map(text => ({ text })),
            type: "quiz",
            correct_option_id: nextQuestion.answer,
            is_anonymous: false
          });

          session.currentIndex = nextIndex;
          session.currentPollId = nextPoll.poll.id;
          practicePollMap[nextPoll.poll.id] = userId;

          sessions[userId] = session;

          await this.ctx.storage.put("practiceSessions", sessions);
          await this.ctx.storage.put("practicePollMap", practicePollMap);

          return reply({ ok: true, practiceSkipped: true });
        }

        session.status = "finished";
        session.currentPollId = null;

        const finalScore = (session.correct * 4) - session.wrong;

        sessions[userId] = session;

        await this.ctx.storage.put("practiceSessions", sessions);
        await this.ctx.storage.put("practicePollMap", practicePollMap);

        await tg(this.env, "sendMessage", {
          chat_id: chatId,
          text:
            "PRACTICE COMPLETED!\n\n" +
            `Quiz: ${session.title}\n` +
            `Total Questions: ${session.questions.length}\n` +
            `Correct: ${session.correct}\n` +
            `Wrong: ${session.wrong}\n` +
            `Unanswered: ${session.unanswered}\n` +
            `Final Score: ${finalScore}\n\n` +
            "Marking: +4 for correct, -1 for wrong."
        });

        return reply({ ok: true, practiceCompleted: true });
      }

      if (command === "/practice") {
        const quizzes =
          (await this.ctx.storage.get("completedQuizzes")) || [];

        const text = quizzes.length
          ? "📚 Completed Quizzes:\n\n" +
            quizzes.map((q, i) =>
              `${i + 1}. ${q.title || "JRF WALLAH Quiz"}`
            ).join("\n") +
            "\n\nTo select a quiz, send /practice 1, /practice 2, etc."
          : "No completed quizzes are available yet. Completed quizzes will appear here."

        await tg(this.env, "sendMessage", {
          chat_id: chatId,
          text
        });
      }

      return reply({ ok: true });
    }

    
    if (url.pathname === "/answer" && request.method === "POST") {
      const answer = await request.json();
      
      const practicePollMap =
        (await this.ctx.storage.get("practicePollMap")) || {};

      const practiceUserId = practicePollMap[answer.poll_id];

      if (practiceUserId) {
        const sessions =
          (await this.ctx.storage.get("practiceSessions")) || {};
        const session = sessions[practiceUserId];

        if (
          !session ||
          session.status !== "running" ||
          session.currentPollId !== answer.poll_id ||
          !Array.isArray(answer.option_ids) ||
          answer.option_ids.length === 0
        ) {
          return reply({ ok: true, ignored: true });
        }

        const currentIndex = session.currentIndex;
        const currentQuestion = session.questions[currentIndex];

        if (!session.answers) session.answers = {};

        session.answers[currentIndex] = answer.option_ids[0];
        delete practicePollMap[answer.poll_id];

        const recordedAnswers = Object.entries(session.answers);
        session.correct = recordedAnswers.filter(
          ([index, selected]) =>
            selected === session.questions[Number(index)].answer
        ).length;

        session.wrong = recordedAnswers.length - session.correct;

        const nextIndex = currentIndex + 1;

        if (nextIndex < session.questions.length) {
          const nextQuestion = session.questions[nextIndex];

          const nextPoll = await tg(this.env, "sendPoll", {
            chat_id: practiceUserId,
            question: nextQuestion.question,
            options: nextQuestion.options.map(text => ({ text })),
            type: "quiz",
            correct_option_id: nextQuestion.answer,
            is_anonymous: false
          });

          session.currentIndex = nextIndex;
          session.currentPollId = nextPoll.poll.id;
          practicePollMap[nextPoll.poll.id] = practiceUserId;

          sessions[practiceUserId] = session;

          await this.ctx.storage.put("practiceSessions", sessions);
          await this.ctx.storage.put("practicePollMap", practicePollMap);

          return reply({ ok: true, practiceAdvanced: true });
        }

        session.status = "finished";
        session.currentPollId = null;
        session.unanswered =
          session.questions.length - recordedAnswers.length;

        const finalScore = (session.correct * 4) - session.wrong;

        sessions[practiceUserId] = session;

        await this.ctx.storage.put("practiceSessions", sessions);
        await this.ctx.storage.put("practicePollMap", practicePollMap);

        await tg(this.env, "sendMessage", {
          chat_id: practiceUserId,
          text:
            "🏆 PRACTICE COMPLETED!\n\n" +
            `Quiz: ${session.title}\n` +
            `Total Questions: ${session.questions.length}\n` +
            `Correct: ${session.correct}\n` +
            `Wrong: ${session.wrong}\n` +
            `Unanswered: ${session.unanswered}\n` +
            `Final Score: ${finalScore}\n\n` +
            "Marking: +4 for correct, -1 for wrong."
        });

        return reply({ ok: true, practiceCompleted: true });
      }

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

    if (url.pathname === "/reset" && request.method === "POST") {
  const state = await this.getState();

  if (state && !["finished", "cancelled"].includes(state.status)) {
    return reply({
      ok: false,
      error: "Reset blocked: quiz is not finished or cancelled"
    }, 409);
  }

  await this.ctx.storage.deleteAlarm();
  await this.ctx.storage.delete("quizState");
  return reply({ ok: true, status: "idle", reset: true });
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
          `🌿 JRF WALLAH 🌿\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `🏆 SOIL SCIENCE | GRAND TEST ALERT\n\n` +
          `🎯 ${state.title}\n\n` +
          `📅 Start Time: ${startTime} IST\n` +
          `📝 Total Questions: ${state.questions.length}\n` +
          `⏱️ Time: 30 seconds per question\n` +
          `📊 Marking: +4 Correct | -1 Wrong | 0 Unanswered\n\n` +
          `📚 TOPICS COVERED\n${state.topics}\n\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `⏳ TEST STARTS IN 5 MINUTES!\n` +
          `🔥 Get ready. Give your best!\n` +
          `💪 ALL THE BEST, JRF WALLAH FAMILY!`
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

        const completedQuizzes =
  (await this.ctx.storage.get("completedQuizzes")) || [];

completedQuizzes.unshift({
  id: String(Date.now()),
  title: state.title || "Completed Quiz",
  questions: state.questions,
  finishedAt: new Date().toISOString()
});

await this.ctx.storage.put(
  "completedQuizzes",
  completedQuizzes.slice(0, 20)
);

state.status = "finished";
await this.putState(state);
await this.ctx.storage.deleteAlarm();
await this.publishLeaderboard(state);
      }
        } catch (error) {
      console.error("Quiz alarm error:", error.message);

      const message = clean(error.message);

      if (message.toLowerCase().includes("poll options length")) {
        state.status = "error";
        await this.putState(state);
        await this.ctx.storage.deleteAlarm();

        await this.sendGroupMessage(
          "⚠️ Quiz stopped: one answer option exceeds Telegram's 100-character limit. Please correct the question bank before restarting."
        ).catch(() => null);

        return;
      }

      await this.sendGroupMessage(
        "⚠️ Quiz engine error: " + message
      ).catch(() => null);

      await this.ctx.storage.setAlarm(Date.now() + 10000);
    }
  }


  
  
  
  async publishLeaderboard(state) {
    const total = state.questions.length;

    const users = Object.values(state.users || {}).map(user => {
      let correct = 0;
      let wrong = 0;
      let answered = 0;

      for (let i = 0; i < total; i++) {
        const selected = user.answers?.[i];

        if (selected === null || selected === undefined) continue;

        answered++;

        if (selected === state.questions[i]?.answer) {
          correct++;
        } else {
          wrong++;
        }
      }

      const unanswered = total - answered;
      const positiveMarks = correct * 4;
      const negativeMarks = wrong;
      const score = positiveMarks - negativeMarks;

      return {
        name: user.name || "Unknown",
        correct,
        wrong,
        unanswered,
        total,
        positiveMarks,
        negativeMarks,
        score,
        maxScore: total * 4
      };
    });

    users.sort((a, b) =>
      b.score - a.score ||
      b.correct - a.correct ||
      a.wrong - b.wrong ||
      a.name.localeCompare(b.name)
    );

    if (!users.length) {
      await this.sendGroupMessage(
        `🏁 ${state.title} COMPLETED!\n\nNo student responses were recorded.`
      );
      return;
    }

    const champion = users[0];

    await this.sendGroupMessage(
      `🏆🌟 JRF WALLAH CHAMPION 🌟🏆\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      `🥇 CHAMPION OF THE TEST\n\n` +
      `👑 ${champion.name}\n\n` +
      `🏅 RANK: 1st\n` +
      `📚 ${state.title}\n` +
      `🎯 FINAL SCORE: ${champion.score} / ${champion.maxScore}\n` +
      `✅ Correct: ${champion.correct}\n` +
      `❌ Wrong: ${champion.wrong}\n` +
      `➖ Unanswered: ${champion.unanswered}\n\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `🎉 CONGRATULATIONS, CHAMPION!\n` +
      `💚 JRF WALLAH FAMILY IS PROUD OF YOU!`
    );

    const header =
      `🏆 JRF WALLAH | FINAL RESULT 🏆\n` +
      `📚 ${state.title}\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `📝 Total Questions: ${total}\n` +
      `👥 Total Participants: ${users.length}\n` +
      `📊 Marking: +4 correct | −1 wrong | 0 unanswered\n\n`;

    const messages = [];
    let message = header;

    users.forEach((user, index) => {
      const entry =
        `${index === 0 ? "🥇 1st RANK | CHAMPION" : `${index + 1}. RANK`}\n` +
        `👤 ${user.name}\n` +
        `🎯 Score: ${user.score} / ${user.maxScore}\n` +
        `✅ Correct: ${user.correct} | ❌ Wrong: ${user.wrong}\n` +
        `➖ Unanswered: ${user.unanswered}\n` +
        `➕ Marks: +${user.positiveMarks} | ➖ Negative: −${user.negativeMarks}\n\n`;

      if (message.length + entry.length > 3500) {
        messages.push(message);
        message = `🏆 ${state.title} RESULT (Continued)\n\n`;
      }

      message += entry;
    });

    if (message.length) messages.push(message);

    for (const part of messages) {
      await this.sendGroupMessage(part);
    }
  }
}
