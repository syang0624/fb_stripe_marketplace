"use client";

import { useState } from "react";
import { Negotiation } from "@/lib/types";

interface ModifyDialogProps {
  negotiation: Negotiation;
  onClose: () => void;
  onModifyLogistics: (meetTime: string, meetPlace: string) => void;
  onModifyPrice: (newTarget: number) => void;
}

type Tab = "logistics" | "price";

export function ModifyDialog({
  negotiation,
  onClose,
  onModifyLogistics,
  onModifyPrice
}: ModifyDialogProps) {
  const offer = negotiation.finalOffer!;
  const [tab, setTab] = useState<Tab>("logistics");
  const [meetTime, setMeetTime] = useState(offer.meetTime);
  const [meetPlace, setMeetPlace] = useState(offer.meetPlace);
  const [newPrice, setNewPrice] = useState(Math.round(offer.finalPrice * 0.9));

  const inputClass =
    "w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-ink/30";
  const labelClass = "mb-1.5 block text-xs font-medium text-ink/50";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20 p-4 animate-fadeIn">
      <div className="w-full max-w-sm overflow-hidden rounded-lg border border-line bg-paper shadow-card">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5">
          <h3 className="text-sm font-medium text-ink">Modify offer</h3>
          <button
            onClick={onClose}
            className="text-xs font-medium text-ink/50 transition-colors hover:text-ink"
          >
            Close
          </button>
        </div>

        {/* Tabs */}
        <div className="mt-4 flex gap-6 border-b border-line px-6">
          {(["logistics", "price"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 pb-2.5 text-xs font-medium capitalize transition-colors ${
                tab === t ? "border-ink text-ink" : "border-transparent text-ink/40 hover:text-ink/70"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="space-y-4 p-6">
          {tab === "logistics" ? (
            <>
              <div>
                <label className={labelClass}>Meet time</label>
                <input
                  value={meetTime}
                  onChange={(e) => setMeetTime(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Meet place</label>
                <input
                  value={meetPlace}
                  onChange={(e) => setMeetPlace(e.target.value)}
                  className={inputClass}
                />
              </div>
              <button
                onClick={() => {
                  onModifyLogistics(meetTime, meetPlace);
                  onClose();
                }}
                className="w-full rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-ink/90"
              >
                Update meet details
              </button>
            </>
          ) : (
            <>
              <div>
                <label className={labelClass}>Current agreed price</label>
                <p className="text-xl font-light tracking-tight text-ink">${offer.finalPrice}</p>
              </div>
              <div>
                <label className={labelClass}>New target price</label>
                <input
                  type="number"
                  value={newPrice}
                  onChange={(e) => setNewPrice(Number(e.target.value))}
                  className={inputClass}
                />
                <p className="mt-1.5 text-xs text-ink/40">
                  This reopens the negotiation at the counter-offer stage.
                </p>
              </div>
              <button
                onClick={() => {
                  onModifyPrice(newPrice);
                  onClose();
                }}
                className="w-full rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-ink/90"
              >
                Reopen at ${newPrice}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
