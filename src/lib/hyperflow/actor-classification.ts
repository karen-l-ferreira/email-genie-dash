// Identificação automática usando o nome e, quando disponível, o tipo
// fornecido pela Hyperflow. IDs opacos nunca viram "humanos" por exclusão.
export type ActorKind = "bot" | "human" | "unknown";
export const KNOWN_ASSISTANTS = ["Duda", "Ada"] as const;

const norm = (name: string) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
const opaqueId = /^(?:[a-f0-9]{16,64}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i;

export function classifyActor(name: string | null | undefined, agentType?: string | null): ActorKind {
  const type = norm(agentType ?? "");
  // Valores reconhecíveis de um tipo explícito prevalecem sobre o nome.
  if (["bot", "robot", "automation", "automated", "assistant", "ai", "ia", "virtual", "chatbot"].includes(type)) return "bot";
  if (["human", "humano", "person", "user", "attendant", "agent", "operator", "operador"].includes(type)) return "human";

  const n = norm(name ?? "");
  if (!n || n === "null" || n === "undefined" || n === "bot" || opaqueId.test(n)) return "unknown";
  if (KNOWN_ASSISTANTS.some((bot) => norm(bot) === n)) return "bot";
  // Um prefixo pode designar outra conta/sistema ("Ada - Thomson Reuters").
  // Sem tipo explícito, não dá para afirmar se é o nosso bot ou um humano.
  if (/^(?:ada|duda)\s*[-–—:/]/.test(n)) return "unknown";
  if (/^(?:bot|chatbot|assistente virtual|virtual assistant)\b/.test(n)) return "bot";
  if (/^(?:ia|ai)\s*[-–—:/]/.test(n)) return "bot";
  return "human";
}
