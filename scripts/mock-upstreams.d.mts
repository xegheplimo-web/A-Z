import type http from "node:http";
export declare function createServer(): http.Server;
export declare const state: { llmCalls: number; hubCalls: number; lastLLMBody: unknown; lastHubBody: unknown };
