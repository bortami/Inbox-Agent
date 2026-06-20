import Anthropic from '@anthropic-ai/sdk';
import type { AIExtractor, ExtractionResult } from './types.js';

const SYSTEM_PROMPT = `You are a lead data extractor for automotive and marine dealers. Your job is to extract structured contact and inquiry information from inbound email messages.

Extract the following data from emails:
- Contact details: first name, last name, email address, phone number
- The buyer's message or inquiry
- Vehicle/listing reference (VIN, stock number, URL, or title if mentioned)
- Whether this is an actual lead from a buyer (vs. notifications, spam, dealer-to-dealer messages, marketing)
- Your confidence in the extraction

Be conservative: if you're not sure about a value, return null. For is_actual_lead, return false for:
- "Your listing was viewed" notifications
- Dealer-to-dealer messages
- Marketing/vendor outreach
- Automated alerts and reports
- Any email that is NOT from a prospective buyer

For confidence:
- high: clear contact info, obvious buyer intent
- medium: some info present but incomplete or ambiguous
- low: very little extractable info or unclear intent`;

const EXTRACT_LEAD_TOOL: Anthropic.Tool = {
  name: 'extract_lead',
  description: 'Extract structured lead data from an inbound email. Always call this tool.',
  input_schema: {
    type: 'object' as const,
    properties: {
      firstname: { type: 'string', description: 'Buyer first name, or null if not found' },
      lastname: { type: 'string', description: 'Buyer last name, or null if not found' },
      email: { type: 'string', description: 'Buyer email address, or null if not found' },
      phone: { type: 'string', description: 'Buyer phone number, or null if not found' },
      message: { type: 'string', description: 'The buyer inquiry or message text' },
      listing_reference: {
        type: 'object',
        description: 'Vehicle/listing reference details, or null if none found',
        properties: {
          vin: { type: 'string' },
          stock_number: { type: 'string' },
          url: { type: 'string' },
          title: { type: 'string' },
        },
      },
      source: {
        type: 'string',
        description: 'The lead source platform name as it appears in the email (e.g. "CarGurus", "AutoTrader", "Boats.com"). Null if not identifiable.',
      },
      is_actual_lead: {
        type: 'boolean',
        description: 'True only if this is a genuine buyer inquiry',
      },
      confidence: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        description: 'Extraction confidence level',
      },
    },
    required: [
      'firstname', 'lastname', 'email', 'phone', 'message',
      'listing_reference', 'source', 'is_actual_lead', 'confidence',
    ],
  },
};

export class ClaudeExtractor implements AIExtractor {
  private client: Anthropic;

  constructor() {
    // maxRetries above the default 2 — transient connection drops to the Anthropic
    // API (e.g. "Premature close" when a socket closes mid-response) are retried
    // automatically with backoff.
    this.client = new Anthropic({ maxRetries: 4 });
  }

  async extract(emailText: string, sourceHint?: string): Promise<ExtractionResult> {
    const userContent = sourceHint
      ? `Source: ${sourceHint}\n\n---\n\n${emailText}`
      : emailText;

    // Stream rather than a single blocking create(). A non-streamed request holds one
    // socket open for the model's full generation; on Cloud Run that connection can be
    // severed mid-response, surfacing as "FetchError: Premature close". Streaming keeps
    // the connection active and avoids the timeout. finalMessage() returns the same
    // Message shape, so downstream handling is unchanged.
    const stream = this.client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [EXTRACT_LEAD_TOOL],
      tool_choice: { type: 'tool', name: 'extract_lead' },
      messages: [{ role: 'user', content: userContent }],
    });
    const response = await stream.finalMessage();

    const toolUseBlock = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    if (!toolUseBlock) {
      throw new Error('Model did not call extract_lead tool');
    }

    return toolUseBlock.input as ExtractionResult;
  }
}
