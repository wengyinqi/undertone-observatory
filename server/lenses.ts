import type {
  Lens,
  LensDefinition,
  SystemOneQuestion,
  SystemOneRequest,
} from "./types.js";

export const LENS_DEFINITIONS: Record<Lens, LensDefinition> = {
  message: {
    id: "message",
    label: "消息显微镜",
    questions: {
      tone: {
        label: "主导语气",
        optionLabels: {
          warm: "温暖",
          neutral: "中性",
          assertive: "坚定",
          guarded: "戒备",
          hostile: "敌意",
        },
        question: {
          type: "choice",
          instructions:
            "Choose the single dominant interpersonal tone. Judge wording and delivery, not the topic itself.",
          criteria: {
            warm: "Friendly, empathetic, appreciative, or inviting.",
            neutral: "Matter-of-fact and emotionally unmarked.",
            assertive: "Clear, firm, and self-assured without hostility.",
            guarded: "Cautious, withholding, defensive, or deliberately distant.",
            hostile: "Attacking, contemptuous, threatening, or openly antagonistic.",
          },
        },
      },
      intent: {
        label: "核心意图",
        optionLabels: {
          inform: "告知",
          request: "请求",
          persuade: "说服",
          connect: "连接",
          confront: "交涉",
        },
        question: {
          type: "choice",
          instructions:
            "Choose the primary action the sender is trying to accomplish with this message.",
          criteria: {
            inform: "Primarily supplies facts, status, or explanation.",
            request: "Primarily asks the reader to do, answer, or provide something.",
            persuade: "Primarily tries to change an opinion or win agreement.",
            connect: "Primarily maintains rapport, offers support, or starts conversation.",
            confront: "Primarily challenges conduct, expresses a grievance, or sets a boundary.",
          },
        },
      },
      urgency: {
        label: "紧迫度",
        lowLabel: "可以等待",
        highLabel: "立即处理",
        question: {
          type: "score",
          instructions:
            "Rate how soon the recipient is expected to act, using only explicit or strongly implied time pressure.",
          criteria: [
            "0 — No action deadline or time pressure.",
            "1 — Action would be useful eventually, but delay has little consequence.",
            "2 — Action is expected soon, roughly within days.",
            "3 — Action is expected today or delay creates a clear problem.",
            "4 — Immediate action is required to avoid imminent harm or failure.",
          ],
        },
      },
      clarity: {
        label: "表达清晰度",
        lowLabel: "难以理解",
        highLabel: "一目了然",
        question: {
          type: "score",
          instructions:
            "Rate how easily a reasonable recipient can understand the point and any requested action without guessing.",
          criteria: [
            "0 — Meaning is incoherent or impossible to recover.",
            "1 — Major ambiguity obscures the point or requested action.",
            "2 — Main point is recoverable but important details are unclear.",
            "3 — Clear overall with only minor ambiguity.",
            "4 — Precise, unambiguous, and immediately actionable where relevant.",
          ],
        },
      },
      reply_expected: {
        label: "期待回复",
        lowLabel: "无需回复",
        highLabel: "需要回应",
        question: {
          type: "noul",
          instructions:
            "Does the sender expect the recipient to reply or acknowledge this message?",
          criteria: {
            true: "A question, request, confirmation need, or conversational opening calls for a response.",
            false: "The message is a closed announcement, statement, or sign-off with no response expected.",
          },
        },
      },
      hidden_tension: {
        label: "潜在张力",
        lowLabel: "坦然直接",
        highLabel: "暗含摩擦",
        question: {
          type: "noul",
          instructions:
            "Is there meaningful interpersonal tension beneath language that may appear polite or neutral?",
          criteria: {
            true: "Subtext suggests frustration, distrust, pressure, defensiveness, or unresolved conflict.",
            false: "Tone and literal content align without meaningful signs of concealed conflict.",
          },
        },
      },
    },
  },
  pitch: {
    id: "pitch",
    label: "提案透视",
    questions: {
      value_frame: {
        label: "价值重心",
        optionLabels: {
          problem_led: "问题导向",
          solution_led: "方案导向",
          outcome_led: "结果导向",
          proof_led: "证据导向",
          ask_led: "行动导向",
        },
        question: {
          type: "choice",
          instructions:
            "Choose the element carrying most of the pitch's persuasive weight.",
          criteria: {
            problem_led: "Leads with the audience's pain, risk, or unmet need.",
            solution_led: "Leads with what the product, proposal, or idea does.",
            outcome_led: "Leads with the concrete result or transformation promised.",
            proof_led: "Leads with evidence, traction, expertise, or social proof.",
            ask_led: "Leads with the requested commitment, purchase, meeting, or decision.",
          },
        },
      },
      likely_reaction: {
        label: "可能反应",
        optionLabels: {
          intrigued: "产生兴趣",
          persuaded: "被说服",
          unconvinced: "尚未信服",
          confused: "感到困惑",
          resistant: "产生抵触",
        },
        question: {
          type: "choice",
          instructions:
            "Choose the most likely immediate reaction from a reasonable but not already committed target audience.",
          criteria: {
            intrigued: "Interested enough to learn more, but not yet convinced.",
            persuaded: "Ready to accept the core claim or take the proposed next step.",
            unconvinced: "Understands the pitch but finds its case too weak.",
            confused: "Cannot clearly tell what is offered, why it matters, or what happens next.",
            resistant: "Actively skeptical, put off, or opposed by the framing.",
          },
        },
      },
      clarity: {
        label: "主张清晰度",
        lowLabel: "主张模糊",
        highLabel: "主张明确",
        question: {
          type: "score",
          instructions:
            "Rate how clearly the pitch identifies its audience, offer, benefit, and requested next step.",
          criteria: [
            "0 — The offer and purpose cannot be identified.",
            "1 — The general topic is visible, but the offer or benefit is obscure.",
            "2 — The offer is understandable, with important gaps in audience, benefit, or next step.",
            "3 — Offer and benefit are clear; only one minor element is weak.",
            "4 — Audience, offer, benefit, and next step are all precise and easy to repeat.",
          ],
        },
      },
      credibility: {
        label: "可信度",
        lowLabel: "缺少依据",
        highLabel: "证据充分",
        question: {
          type: "score",
          instructions:
            "Rate how well the pitch supports its claims with specifics, evidence, mechanism, constraints, or credible proof.",
          criteria: [
            "0 — Relies entirely on unsupported assertion or implausible promise.",
            "1 — Offers weak, vague, or unverifiable support.",
            "2 — Gives some concrete support but leaves major claims ungrounded.",
            "3 — Most important claims have relevant and plausible support.",
            "4 — Key claims are specific, appropriately bounded, and backed by strong evidence or mechanism.",
          ],
        },
      },
      concrete_value: {
        label: "价值具体",
        lowLabel: "价值抽象",
        highLabel: "收益可感",
        question: {
          type: "noul",
          instructions:
            "Does the pitch state a concrete outcome the audience can recognize or evaluate?",
          criteria: {
            true: "It names a specific result, improvement, avoided cost, or measurable benefit.",
            false: "It relies on broad adjectives or features without a recognizable audience outcome.",
          },
        },
      },
      clear_next_step: {
        label: "行动入口",
        lowLabel: "下一步不明",
        highLabel: "行动明确",
        question: {
          type: "noul",
          instructions:
            "Does the pitch make the desired next action clear and realistically actionable?",
          criteria: {
            true: "The audience can tell exactly what to do next and the action is feasible.",
            false: "There is no ask, the ask is ambiguous, or the next step is impractical.",
          },
        },
      },
    },
  },
  story: {
    id: "story",
    label: "故事心电图",
    questions: {
      emotional_mode: {
        label: "情绪底色",
        optionLabels: {
          hopeful: "希望",
          joyful: "喜悦",
          uneasy: "不安",
          ominous: "不祥",
          melancholic: "忧郁",
          neutral: "平静",
        },
        question: {
          type: "choice",
          instructions:
            "Choose the dominant emotional atmosphere created by this passage, not merely the emotion named in it.",
          criteria: {
            hopeful: "Creates expectation of possibility, recovery, or positive change.",
            joyful: "Creates delight, playfulness, relief, or celebration.",
            uneasy: "Creates uncertainty, discomfort, or low-level anxiety.",
            ominous: "Creates foreboding, danger, dread, or an approaching threat.",
            melancholic: "Creates sadness, loss, longing, or reflective regret.",
            neutral: "Primarily functional or descriptive without a strong emotional atmosphere.",
          },
        },
      },
      narrative_role: {
        label: "叙事作用",
        optionLabels: {
          setup: "铺陈",
          escalation: "升级",
          reversal: "逆转",
          climax: "高潮",
          resolution: "收束",
          transition: "过渡",
        },
        question: {
          type: "choice",
          instructions:
            "Choose the passage's primary structural role within a plausible larger narrative.",
          criteria: {
            setup: "Introduces context, character, desire, place, or a governing situation.",
            escalation: "Raises stakes, complications, conflict, or pressure.",
            reversal: "Changes the audience's understanding or redirects the course of events.",
            climax: "Presents a decisive confrontation, choice, or peak of pressure.",
            resolution: "Settles a central tension or shows consequences after a decisive event.",
            transition: "Connects beats, relocates attention, or compresses time without major escalation.",
          },
        },
      },
      tension: {
        label: "叙事张力",
        lowLabel: "平静舒展",
        highLabel: "高度紧绷",
        question: {
          type: "score",
          instructions:
            "Rate the active uncertainty, conflict, stakes, or anticipation that makes a reader need to know what happens next.",
          criteria: [
            "0 — No meaningful uncertainty, conflict, stakes, or anticipation.",
            "1 — A faint question or friction exists but carries little consequence.",
            "2 — A clear unresolved pressure or goal sustains interest.",
            "3 — Strong conflict or stakes make the next beat consequential.",
            "4 — Immediate, high-stakes uncertainty creates peak narrative pressure.",
          ],
        },
      },
      momentum: {
        label: "推进速度",
        lowLabel: "近乎静止",
        highLabel: "快速推进",
        question: {
          type: "score",
          instructions:
            "Rate how much the passage changes the situation through action, revelation, decision, or irreversible consequence.",
          criteria: [
            "0 — The situation is essentially unchanged.",
            "1 — Adds texture or information with little forward movement.",
            "2 — Produces a modest change, discovery, or decision.",
            "3 — Clearly advances the plot or relationship in a consequential way.",
            "4 — Causes a rapid, major, or irreversible change in the narrative situation.",
          ],
        },
      },
      turning_point: {
        label: "发生转折",
        lowLabel: "延续原局面",
        highLabel: "改变了方向",
        question: {
          type: "noul",
          instructions:
            "Does this passage contain a genuine turning point that changes goals, knowledge, power, or the likely direction of events?",
          criteria: {
            true: "A revelation, decision, reversal, arrival, loss, or action materially redirects what follows.",
            false: "Events continue, elaborate, or intensify the existing trajectory without redirecting it.",
          },
        },
      },
      character_agency: {
        label: "角色能动性",
        lowLabel: "被动承受",
        highLabel: "主动驱动",
        question: {
          type: "noul",
          instructions:
            "Is the focal character actively shaping events through a meaningful choice or purposeful action?",
          criteria: {
            true: "The character chooses, initiates, resists, or pursues something that affects the situation.",
            false: "The character mainly observes, receives information, or is moved by external events without a meaningful choice.",
          },
        },
      },
    },
  },
};

export function getLensDefinition(lens: Lens): LensDefinition {
  return LENS_DEFINITIONS[lens];
}

export function buildQuestions(lens: Lens): Record<string, SystemOneQuestion> {
  return Object.fromEntries(
    Object.entries(getLensDefinition(lens).questions).map(([id, definition]) => [
      id,
      definition.question,
    ]),
  );
}

export function buildSystemOneRequest(
  text: string,
  lens: Lens,
  model: string,
): SystemOneRequest {
  return {
    model,
    state: text,
    questions: buildQuestions(lens),
  };
}
