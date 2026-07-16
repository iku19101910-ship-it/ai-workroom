// パイプライン実行エンジン(§4.4)。前段の出力を次段の入力とし、1ボタンで実行。
// 実行ログは通常の会話として保存(観測可能性の確保)。
// §4.16: ステップ実行中に確認質問が返された場合、一時停止して回答後に該当ステップから再開。
const { getKey } = require("./keys.cjs");
const ws = require("./workspace.cjs");
const {
  buildSystemText,
  buildBibleText,
  tryParseClarification,
} = require("./prompt.cjs");
const { getProvider } = require("./models.cjs");

// 実行中/一時停止中のラン状態(runId -> state)
const runs = new Map();

function stepInputText(step, input) {
  return step.instruction ? `${step.instruction}\n\n${input}` : input;
}

async function executeStep(run, emit, extraAnswer) {
  const { pipeline, conversationId } = run;
  const step = pipeline.steps[run.stepIndex];
  const card = ws.getRoleCard(step.role_card_id);
  if (!card) throw new Error(`ステップ${run.stepIndex + 1}: 役割カードが見つかりません`);
  const provider = getProvider(card.provider);
  const apiKey = getKey(card.provider);
  if (!apiKey) throw new Error(`${card.provider} のAPIキーが未設定です`);
  if (!card.model) throw new Error(`${card.name}: モデルが未選択です`);

  const settings = ws.getSettings();
  const input = step.input_from === "user" ? run.userInput : run.prevOutput ?? run.userInput;
  let text = stepInputText(step, input);
  if (extraAnswer) text = `${text}\n\n【確認質問への回答】\n${extraAnswer}`;

  // ステップの入力をユーザーメッセージとして記録
  const userMsg = ws.appendMessage(conversationId, { author: "user", content: text });
  emit("pipeline:step-start", {
    runId: run.id,
    stepIndex: run.stepIndex,
    totalSteps: pipeline.steps.length,
    cardName: card.name,
    conversationId,
    message: userMsg,
  });

  const mode = pipeline.allow_clarification ? "normal" : "no_clarification";
  const result = await provider.sendMessage({
    apiKey,
    model: card.model,
    systemText: buildSystemText(card, mode),
    bibleText: buildBibleText(card),
    messages: [{ role: "user", content: text }],
    maxTokens: settings.chat.max_tokens,
    signal: run.controller.signal,
    onDelta: (delta) => emit("pipeline:delta", { runId: run.id, stepIndex: run.stepIndex, delta }),
  });

  const clarification = pipeline.allow_clarification
    ? tryParseClarification(result.text)
    : null;

  const assistantMsg = ws.appendMessage(conversationId, {
    author: "assistant",
    role_card_id: card.id,
    model: card.model,
    content: result.text,
    tokens: { input: result.usage.input, output: result.usage.output },
    clarification,
  });

  ws.recordUsage({
    role_card_id: card.id,
    provider: card.provider,
    model: card.model,
    input: result.usage.input,
    output: result.usage.output,
    cache_read: result.usage.cache_read,
    cache_write: result.usage.cache_write,
  });

  return { result, clarification, assistantMsg, cardName: card.name };
}

async function continueRun(run, emit, extraAnswer) {
  const { pipeline } = run;
  try {
    while (run.stepIndex < pipeline.steps.length) {
      const { result, clarification, assistantMsg, cardName } = await executeStep(
        run,
        emit,
        extraAnswer
      );
      extraAnswer = null;

      if (clarification) {
        // 一時停止: 回答を待つ(§4.16)
        run.paused = true;
        emit("pipeline:clarification", {
          runId: run.id,
          stepIndex: run.stepIndex,
          cardName,
          conversationId: run.conversationId,
          message: assistantMsg,
          clarification,
        });
        return; // answerPipeline で再開
      }

      emit("pipeline:step-done", {
        runId: run.id,
        stepIndex: run.stepIndex,
        message: assistantMsg,
      });
      run.prevOutput = result.text;
      run.stepIndex += 1;
    }
    runs.delete(run.id);
    emit("pipeline:done", { runId: run.id, conversationId: run.conversationId, output: run.prevOutput });
  } catch (err) {
    runs.delete(run.id);
    const aborted = run.controller.signal.aborted;
    emit("pipeline:error", {
      runId: run.id,
      conversationId: run.conversationId,
      stepIndex: run.stepIndex,
      error: aborted ? "(中断されました)" : String(err?.message || err),
      aborted,
    });
  }
}

// 実行開始。会話を新規作成してログを残す。
async function runPipeline({ pipelineId, input, runId }, emit) {
  const pipeline = ws.getPipeline(pipelineId);
  if (!pipeline) throw new Error("パイプラインが見つかりません");
  if (!pipeline.steps || pipeline.steps.length === 0) throw new Error("ステップがありません");

  const date = new Date().toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const conv = ws.createConversation(`【PL】${pipeline.name} ${date}`);

  const run = {
    id: runId,
    pipeline,
    conversationId: conv.id,
    stepIndex: 0,
    userInput: input,
    prevOutput: null,
    paused: false,
    controller: new AbortController(),
  };
  runs.set(runId, run);
  emit("pipeline:start", {
    runId,
    conversationId: conv.id,
    pipelineName: pipeline.name,
    totalSteps: pipeline.steps.length,
  });

  continueRun(run, emit); // awaitしない(イベントで進捗通知)
  return { conversationId: conv.id };
}

// 確認質問への回答で再開
function answerPipeline({ runId, answerText }, emit) {
  const run = runs.get(runId);
  if (!run || !run.paused) return false;
  run.paused = false;
  continueRun(run, emit, answerText);
  return true;
}

function abortPipeline(runId) {
  const run = runs.get(runId);
  if (run) {
    run.controller.abort();
    runs.delete(runId);
  }
  return !!run;
}

// 一時停止中(回答待ち)のランを取得(UI再表示用)
function pendingClarifications() {
  return [...runs.values()]
    .filter((r) => r.paused)
    .map((r) => ({ runId: r.id, conversationId: r.conversationId, stepIndex: r.stepIndex, pipelineName: r.pipeline.name }));
}

module.exports = { runPipeline, answerPipeline, abortPipeline, pendingClarifications };
