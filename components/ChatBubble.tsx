import { Message } from "@/lib/types";

interface ChatBubbleProps {
  role: Message["role"];
  content: string;
  timestamp: number;
  sellerLabel?: string;
}

// agent_note and system render as quiet, centered annotations (no bubble) so the
// buyer/seller exchange reads cleanly. The other roles use minimal surfaces.
const bubbleByRole: Record<"buyer" | "seller" | "draft", string> = {
  buyer: "ml-auto bg-ink text-white",
  seller: "mr-auto bg-mist text-ink",
  draft: "ml-auto border border-dashed border-line bg-paper text-ink"
};

const labelByRole: Record<"buyer" | "seller" | "draft", string> = {
  buyer: "You",
  seller: "Seller",
  draft: "Draft"
};

export function ChatBubble({ role, content, timestamp, sellerLabel }: ChatBubbleProps) {
  if (role === "agent_note") {
    const isScamNote = content.toLowerCase().startsWith("scam detected:") || content.toLowerCase().startsWith("caution:");
    if (isScamNote) {
      return (
        <div className="mx-auto max-w-[85%] rounded-md bg-red-50 px-3 py-2 text-center animate-fadeIn">
          <p className="text-xs font-semibold text-red-700">&#9888; {content}</p>
        </div>
      );
    }
    return (
      <p className="mx-auto max-w-[85%] text-center text-xs italic leading-relaxed text-ink/40 animate-fadeIn">
        {content}
      </p>
    );
  }

  if (role === "system") {
    return (
      <p className="mx-auto max-w-[90%] text-center text-xs leading-relaxed text-ink/45 animate-fadeIn">
        {content}
      </p>
    );
  }

  return (
    <div className={`max-w-[78%] rounded-md px-4 py-2.5 animate-fadeIn ${bubbleByRole[role]}`}>
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wide opacity-50">
        {role === "seller" && sellerLabel ? sellerLabel : labelByRole[role]}
      </p>
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{content}</p>
      <p className="mt-1.5 text-right text-[10px] tabular-nums opacity-40">
        {new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </p>
    </div>
  );
}
