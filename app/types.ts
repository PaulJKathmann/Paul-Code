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
}