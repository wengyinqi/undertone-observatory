import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BookOpenText,
  Download,
  FlaskConical,
  GitCompareArrows,
  History,
  LoaderCircle,
  MessageCircle,
  Play,
  Presentation,
  Sparkles,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { analyzeText, getStatus } from "./api";
import AnalysisResultView from "./components/AnalysisResultView";
import HistoryDrawer from "./components/HistoryDrawer";
import type { AnalysisPair, HistoryEntry, Lens, StatusResponse } from "./types";

const HISTORY_KEY = "undertone.history.v1";
const MAX_HISTORY = 8;

const LENSES = [
  { id: "message" as const, label: "消息", caption: "语气与意图", icon: MessageCircle },
  { id: "pitch" as const, label: "提案", caption: "主张与说服力", icon: Presentation },
  { id: "story" as const, label: "故事", caption: "张力与叙事脉搏", icon: BookOpenText },
];

const EXAMPLES: Record<Lens, string[]> = {
  message: [
    "这个方向我没有意见。你们可以先继续做，下周评审时我们再一起看看数据。只是时间比较紧，最好别让我到时候才第一次看到成品。",
    "收到，谢谢。方案整体很完整，我晚点再细看一下。如果没有新的反馈，就先按这个版本推进吧。",
  ],
  pitch: [
    "UNDERTONE 是一间文字信号观测站。它不生成更多内容，而是把消息、提案和故事里的语气、风险与不确定性变成可比较的概率信号，让团队在采取行动前先看清文字真正传递了什么。",
    "我们为小型餐厅提供按需备货系统。系统根据天气、节假日和历史销量给出采购建议，目标是把每天的食材浪费降低 20%，同时不改变店员原有的下单习惯。",
  ],
  story: [
    "雨停以后，林岚才发现门口那双泥鞋不是父亲的。屋里没有开灯，餐桌上却摆着两杯还冒着热气的茶。她没有出声，只把钥匙重新攥回手心，退到走廊的阴影里。",
    "火车驶出隧道时，全车的人同时收到一条来自三天后的短信。只有周野的手机没有响，而他座位前的小桌板上，多出了一张写着自己名字的旧车票。",
  ],
};

const PLACEHOLDERS: Record<Lens, string> = {
  message: "粘贴一段消息、邮件或对话……",
  pitch: "放入一个产品、项目或观点提案……",
  story: "放入一段故事、场景或对白……",
};

function loadHistory(): HistoryEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.slice(0, MAX_HISTORY) : [];
  } catch {
    return [];
  }
}

function containsCjk(value: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/u.test(value);
}

function downloadJson(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [lens, setLens] = useState<Lens>("message");
  const [text, setText] = useState(EXAMPLES.message[0]);
  const [comparisonText, setComparisonText] = useState("");
  const [comparison, setComparison] = useState(false);
  const [result, setResult] = useState<AnalysisPair | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exampleIndex, setExampleIndex] = useState<Record<Lens, number>>({ message: 0, pitch: 0, story: 0 });

  useEffect(() => {
    const controller = new AbortController();
    getStatus(controller.signal)
      .then((nextStatus) => {
        setStatus(nextStatus);
        setStatusFailed(false);
      })
      .catch(() => setStatusFailed(true));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }, [history]);

  const currentLens = useMemo(() => LENSES.find((item) => item.id === lens)!, [lens]);
  const canAnalyze = text.trim().length >= 8 && (!comparison || comparisonText.trim().length >= 8) && !loading;
  const cjkNotice = Boolean(result && (containsCjk(text) || containsCjk(comparisonText)));

  const selectLens = (nextLens: Lens) => {
    setLens(nextLens);
    setText(EXAMPLES[nextLens][0]);
    setComparisonText("");
    setResult(null);
    setError(null);
  };

  const loadExample = () => {
    const nextIndex = (exampleIndex[lens] + 1) % EXAMPLES[lens].length;
    setExampleIndex((current) => ({ ...current, [lens]: nextIndex }));
    setText(EXAMPLES[lens][nextIndex]);
    setResult(null);
  };

  const runAnalysis = async () => {
    if (!canAnalyze) return;
    setLoading(true);
    setError(null);
    try {
      const [primary, secondary] = await Promise.all([
        analyzeText(text.trim(), lens),
        comparison ? analyzeText(comparisonText.trim(), lens) : Promise.resolve(undefined),
      ]);
      const nextResult = { primary, secondary };
      setResult(nextResult);
      const entry: HistoryEntry = {
        ...nextResult,
        id: primary.meta.requestId || `${Date.now()}`,
        lens,
        text: text.trim(),
        comparisonText: comparison ? comparisonText.trim() : undefined,
        createdAt: primary.meta.analyzedAt || new Date().toISOString(),
      };
      setHistory((current) => [entry, ...current.filter((item) => item.id !== entry.id)].slice(0, MAX_HISTORY));
      getStatus().then(setStatus).catch(() => undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "本次观测未完成，请稍后重试。");
    } finally {
      setLoading(false);
    }
  };

  const restoreHistory = (entry: HistoryEntry) => {
    setLens(entry.lens);
    setText(entry.text);
    setComparison(Boolean(entry.comparisonText));
    setComparisonText(entry.comparisonText ?? "");
    setResult({ primary: entry.primary, secondary: entry.secondary });
    setHistoryOpen(false);
    setError(null);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="UNDERTONE 首页">
          <span className="brand-mark"><Activity size={18} strokeWidth={2.2} /></span>
          <span><strong>UNDERTONE</strong><small>字里行间观测站</small></span>
        </a>
        <div className="topbar-actions">
          {typeof status?.usage?.remainingUsd === "number" && (
            <div className="budget-chip" title={`预算 $${status.usage.budgetUsd?.toFixed(2) ?? "5.00"}`}>
              <span>余额</span><strong>${status.usage.remainingUsd.toFixed(4)}</strong>
            </div>
          )}
          <div className={`api-status ${status?.configured ? "is-online" : ""}`} title={status?.model ?? "API 状态"}>
            {status?.configured ? <Wifi size={15} /> : <WifiOff size={15} />}
            <span>{status?.configured ? "链路正常" : status ? "尚未配置" : statusFailed ? "链路未响应" : "正在校准"}</span>
          </div>
          <button className="icon-text-button" type="button" onClick={() => setHistoryOpen(true)}>
            <History size={17} /><span>观测档案</span>{history.length > 0 && <b>{history.length}</b>}
          </button>
        </div>
      </header>

      <main id="top">
        <section className="masthead">
          <div>
            <p className="eyebrow"><FlaskConical size={15} /> SIGNAL OBSERVATORY / 01</p>
            <h1>看见文字里的<br /><em>未说出口。</em></h1>
          </div>
          <p className="masthead-note">概率不是结论。<br />它让含混变得可见。</p>
        </section>

        <nav className="lens-switcher" aria-label="选择观测镜头">
          {LENSES.map(({ id, label, caption, icon: Icon }, index) => (
            <button key={id} type="button" className={lens === id ? "is-active" : ""} onClick={() => selectLens(id)}>
              <span className="lens-index">0{index + 1}</span><Icon size={19} />
              <span><strong>{label}</strong><small>{caption}</small></span>
            </button>
          ))}
        </nav>

        <section className="workbench" aria-label={`${currentLens.label}观测台`}>
          <div className="editor-panel">
            <div className="panel-heading">
              <div><span>INPUT / 输入</span><h2>{currentLens.label}样本</h2></div>
              <label className="compare-toggle">
                <input type="checkbox" checked={comparison} onChange={(event) => setComparison(event.target.checked)} />
                <span className="toggle-track"><span /></span><GitCompareArrows size={16} /> 对比
              </label>
            </div>

            <div className={`editor-grid ${comparison ? "is-comparing" : ""}`}>
              <label className="editor-field">
                <span className="sample-label"><i>A</i> 主样本</span>
                <textarea value={text} onChange={(event) => { setText(event.target.value); setResult(null); }} placeholder={PLACEHOLDERS[lens]} maxLength={6000} />
                <span className="character-count">{text.length.toLocaleString()} / 6,000</span>
              </label>
              {comparison && (
                <label className="editor-field comparison-field">
                  <span className="sample-label"><i>B</i> 对照样本</span>
                  <textarea value={comparisonText} onChange={(event) => { setComparisonText(event.target.value); setResult(null); }} placeholder="放入用于对照的第二段文本……" maxLength={6000} autoFocus />
                  <span className="character-count">{comparisonText.length.toLocaleString()} / 6,000</span>
                </label>
              )}
            </div>

            {error && <div className="error-banner"><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="关闭错误"><X size={16} /></button></div>}

            <div className="editor-actions">
              <button className="secondary-button" type="button" onClick={loadExample}><Sparkles size={17} /> 换个样本</button>
              <button className="analyze-button" type="button" disabled={!canAnalyze} onClick={runAnalysis}>
                {loading ? <LoaderCircle className="spin" size={18} /> : <Play size={18} fill="currentColor" />}
                {loading ? "正在观测" : comparison ? "开始对照" : "开始观测"}
              </button>
            </div>
          </div>

          <div className="result-panel">
            <div className="panel-heading result-heading">
              <div><span>RETURN / 回波</span><h2>信号指纹</h2></div>
              <button className="icon-button" type="button" disabled={!result} onClick={() => result && downloadJson({ lens, text, comparisonText: comparison ? comparisonText : undefined, ...result }, `undertone-${Date.now()}.json`)} title="导出 JSON" aria-label="导出 JSON">
                <Download size={18} />
              </button>
            </div>
            <AnalysisResultView result={result} loading={loading} cjkNotice={cjkNotice} />
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <span>UNDERTONE © 2026</span><span>STRUCTURED SIGNALS, HUMAN JUDGMENT.</span>
      </footer>

      <HistoryDrawer
        open={historyOpen}
        entries={history}
        onClose={() => setHistoryOpen(false)}
        onSelect={restoreHistory}
        onDelete={(id) => setHistory((current) => current.filter((item) => item.id !== id))}
        onExport={() => downloadJson(history, "undertone-history.json")}
      />
    </div>
  );
}
