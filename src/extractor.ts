import OpenAI from "openai";
import type {
  ConversationTurn,
  Extractor,
  ExtractorExample,
  LLMExtractorConfig,
} from "./types.js";

const DEFAULT_MODEL = "gpt-4.1-nano";

const DEFAULT_SYSTEM_PROMPT = `You extract distinct, self-contained facts from a conversation turn that would be worth remembering for future reference.

Rules:
- Return facts as short, atomic statements ("User decided X" not "User decided X because Y happened then Z followed")
- Only extract facts that would be useful in a future conversation
- Ignore questions, acknowledgments, and pleasantries
- If the turn contains no facts worth remembering, return an empty array
- Prefer paraphrased facts over verbatim quotes
- Each fact should stand alone without requiring context from other facts`;

const DEFAULT_EXAMPLES: ExtractorExample[] = [
  {
    input: {
      role: "user",
      content: "I decided against Hono because mobile flexibility matters more",
    },
    output: [
      "User decided against using Hono framework",
      "User prioritizes mobile flexibility in framework choices",
    ],
  },
  {
    input: {
      role: "user",
      content: "What's the weather like today?",
    },
    output: [],
  },
  {
    input: {
      role: "assistant",
      content: "Rajesh said standup is now at 10am Mondays starting next week",
    },
    output: [
      "Standup moved to 10am Mondays",
      "Rajesh announced the standup schedule change",
    ],
  },
];

const EXTRACTED_FACTS_RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "extracted_facts",
    strict: true,
    schema: {
      type: "object",
      properties: {
        facts: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["facts"],
      additionalProperties: false,
    },
  },
};

function isFactsPayload(value: unknown): value is { facts: string[] } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (!("facts" in value)) {
    return false;
  }
  const facts = (value as { facts: unknown }).facts;
  return (
    Array.isArray(facts) && facts.every((item) => typeof item === "string")
  );
}

export class LLMExtractor implements Extractor {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly systemPrompt: string;
  private readonly examples: ExtractorExample[];

  constructor(config: LLMExtractorConfig, client?: OpenAI) {
    if (!config.apiKey) {
      throw new Error("LLMExtractor: apiKey is required");
    }
    this.client = client ?? new OpenAI({ apiKey: config.apiKey });
    this.model = config.model ?? DEFAULT_MODEL;
    this.systemPrompt = config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.examples = config.examples ?? DEFAULT_EXAMPLES;
  }

  async extract(turn: ConversationTurn): Promise<string[]> {
    if (typeof turn.content !== "string" || turn.content.length === 0) {
      throw new Error(
        "LLMExtractor.extract: turn.content must be a non-empty string",
      );
    }

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: this.systemPrompt },
    ];

    for (const example of this.examples) {
      messages.push({
        role: "user",
        content: JSON.stringify(example.input),
      });
      messages.push({
        role: "assistant",
        content: JSON.stringify(example.output),
      });
    }

    messages.push({
      role: "user",
      content: JSON.stringify(turn),
    });

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      response_format: EXTRACTED_FACTS_RESPONSE_FORMAT,
    });

    const rawContent = response.choices[0]?.message?.content;
    if (rawContent === null || rawContent === undefined) {
      throw new Error(
        "LLMExtractor.extract: no message content in API response",
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContent) as unknown;
    } catch {
      throw new Error("LLMExtractor.extract: response content is not valid JSON");
    }

    if (!isFactsPayload(parsed)) {
      throw new Error(
        "LLMExtractor.extract: response JSON missing string[] facts field",
      );
    }

    return parsed.facts;
  }
}
