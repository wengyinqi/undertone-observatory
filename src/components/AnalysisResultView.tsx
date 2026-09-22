import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleGauge, Languages, Radio, ScanLine } from "lucide-react";
import type { AnalysisPair, ChoiceResult, Signal } from "../types";
import SignalRadar from "./SignalRadar";

interface AnalysisResultViewProps {
  result: AnalysisPair | null;
  loading: boolean;
  cjkNotice: boolean;
}

const percent = (value: number) => `${Math.round(value * 100)}%`;
const money = (value: number) => value < 0.001 ? `$${value.toFixed(6)}` : `$${value.toFixed(4)}`;

function SignalList({ primary, secondary, selectedId, onSelect }: {
  primary: Signal[];
  secondary?: Signal[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const secondaryById = new Map(secondary?.map((signal) => [signal.id, signal]));
  return (
    <div className="signal-list">
      {primary.map((signal, index) => {
        const compared = secondaryById.get(signal.id);
        return (
          <button key={signal.id} type="button" className={selectedId === signal.id ? "is-active" : ""} onClick={() => onSelect(signal.id)}>
            <span className="signal-row-head">
              <i>{String(index + 1).padStart(2, "0")}</i><strong>{signal.label}</strong><b>{percent(signal.value)}</b>
              {compared && <b className="comparison-value">{percent(compared.value)}</b>}
            </span>
            <span className="signal-track"><span className="signal-fill primary" style={{ width: percent(signal.value) }} />{compared && <span className="signal-fill secondary" style={{ width: percent(compared.value) }} />}</span>
          </button>
        );
      })}
    </div>
  );
}

function ChoiceBlock({ choice, compared }: { choice: ChoiceResult; compared?: ChoiceResult }) {
  const secondaryOptions = new Map(compared?.options.map((option) => [option.id, option]));
  return (
    <article className="choice-block">
      <div className="choice-title">
        <div><span>CHOICE</span><h4>{choice.label}</h4></div>
        <div className="choice-verdict"><CheckCircle2 size={15} /><span>{choice.selectedLabel || choice.options.find((option) => option.id === choice.selected)?.label || choice.selected}</span><b>{percent(choice.confidence)}</b></div>
      </div>
      <div className="distribution-list">
        {[...choice.options].sort((a, b) => b.probability - a.probability).map((option) => {
          const other = secondaryOptions.get(option.id);
          return (
            <div className="distribution-row" key={option.id}>
              <span className="distribution-label">{option.label}</span>
              <div className="distribution-bars">
                <span><i className="primary" style={{ width: percent(option.probability) }} /></span>
                {other && <span><i className="secondary" style={{ width: percent(other.probability) }} /></span>}
              </div>
              <span className="distribution-value">{percent(option.probability)}{other ? ` / ${percent(other.probability)}` : ""}</span>
            </div>
          );
        })}
      </div>
    </article>
  );
}

export default function AnalysisResultView({ result, loading, cjkNotice }: AnalysisResultViewProps) {
  const [selectedId, setSelectedId] = useState<string>();
  useEffect(() => setSelectedId(result?.primary.signals[0]?.id), [result]);

  const selected = result?.primary.signals.find((signal) => signal.id === selectedId) ?? result?.primary.signals[0];
  const comparedSelected = result?.secondary?.signals.find((signal) => signal.id === selected?.id);
  const lowCertainty = useMemo(() => {
    if (!result) return [];
    const signalLabels = result.primary.signals.filter((signal) => signal.certainty < 0.6).map((signal) => signal.label);
    const choiceLabels = result.primary.choices.filter((choice) => choice.confidence < 0.6).map((choice) => choice.label);
    return [...signalLabels, ...choiceLabels];
  }, [result]);

  if (loading) {
    return (
      <div className="result-state loading-state" aria-live="polite">
        <div className="scanner"><ScanLine size={38} /><span /></div>
        <strong>信号采集中</strong><p>正在校准概率与确定性…</p>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="result-state empty-state">
        <div className="empty-orbit"><Radio size={34} /><i /><i /><i /></div>
        <strong>等待回波</strong><p>NO SIGNAL CAPTURED</p>
      </div>
    );
  }

  const secondaryChoiceMap = new Map(result.secondary?.choices.map((choice) => [choice.id, choice]));
  const metaA = result.primary.meta;
  const metaB = result.secondary?.meta;
  const inputTokens = metaA.usage.inputTokens + (metaB?.usage.inputTokens ?? 0);
  const outputTokens = metaA.usage.outputTokens + (metaB?.usage.outputTokens ?? 0);
  const cost = metaA.estimatedCostUsd + (metaB?.estimatedCostUsd ?? 0);
  const duration = Math.max(metaA.durationMs, metaB?.durationMs ?? 0);

  return (
    <div className="analysis-return" aria-live="polite">
      <div className="fingerprint-layout">
        <SignalRadar primary={result.primary.signals} secondary={result.secondary?.signals} selectedId={selected?.id} onSelect={setSelectedId} />
        <div className="signal-readout">
          {selected ? (
            <>
              <span className="readout-kicker"><CircleGauge size={15} /> SELECTED SIGNAL</span>
              <div className="readout-value"><strong>{percent(selected.value)}</strong>{comparedSelected && <strong className="secondary">{percent(comparedSelected.value)}</strong>}</div>
              <h3>{selected.label}</h3>
              <div className="scale-labels"><span>{selected.lowLabel}</span><i /><span>{selected.highLabel}</span></div>
              <p>确定性 {percent(selected.certainty)}{comparedSelected ? ` / ${percent(comparedSelected.certainty)}` : ""}</p>
              {selected.certaintySource === "derived_probability_distance" && <small>由概率距中性点推导</small>}
            </>
          ) : <p>此镜头未返回连续信号。</p>}
        </div>
      </div>

      <SignalList primary={result.primary.signals} secondary={result.secondary?.signals} selectedId={selected?.id} onSelect={setSelectedId} />

      {result.primary.choices.length > 0 && (
        <div className="choice-section">
          <div className="section-label"><span>判断分布</span><i /></div>
          {result.primary.choices.map((choice) => <ChoiceBlock key={choice.id} choice={choice} compared={secondaryChoiceMap.get(choice.id)} />)}
        </div>
      )}

      {(lowCertainty.length > 0 || cjkNotice) && (
        <div className="caveats">
          {lowCertainty.length > 0 && <p><AlertTriangle size={15} /><span>低确定性：{lowCertainty.join("、")}，保留人工判断。</span></p>}
          {cjkNotice && <p><Languages size={15} /><span>中文信号仅供探索，低确定项建议人工判断。</span></p>}
        </div>
      )}

      <dl className="usage-strip">
        <div><dt>模型</dt><dd>{metaA.model}</dd></div>
        <div><dt>输入 / 输出</dt><dd>{inputTokens.toLocaleString()} / {outputTokens.toLocaleString()} tk</dd></div>
        <div><dt>本次估算</dt><dd>{money(cost)}</dd></div>
        <div><dt>耗时</dt><dd>{duration.toLocaleString()} ms</dd></div>
        <div><dt>余额</dt><dd>${Math.min(metaA.remainingUsd, metaB?.remainingUsd ?? metaA.remainingUsd).toFixed(4)}</dd></div>
      </dl>
    </div>
  );
}
