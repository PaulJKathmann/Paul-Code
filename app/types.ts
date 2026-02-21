export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    execute: (args: Record<string, unknown>) => Promise<string> | string;
}

export interface AgentConfig {
    model: string;
    maxIterations: number;
    baseURL: string;
    apiKey: string;
    contextWindowSize: number;
}

export interface ContextBudget {
  windowSize: number;
  systemPromptTokens: number;
  toolSchemaTokens: number;
  reservedForResponse: number;
  safetyMargin: number;
}

export interface ContextUsage {
  used: number;
  available: number;
  percentage: number;
}
