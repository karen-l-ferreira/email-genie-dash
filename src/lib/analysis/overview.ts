import type { Campaign } from "@/lib/ac.functions";

// One definition of "overall open rate / click rate" shared by Dashboard and Fluxos,
// so the same campaigns always give the same number on both screens.

// Drafts, test sends and tiny sends say nothing about real performance.
export function isRealSend(c: Campaign): boolean {
  return c.send_amt >= 100 && !/^\s*(new campaign|teste?\b|test\b)/i.test(c.name);
}

export type Summary = {
  count: number; // campaigns that entered the calculation
  sent: number; // total e-mails sent
  open_rate: number; // total unique opens ÷ total sent
  ctr: number; // total unique clicks ÷ total sent
};

// Volume-weighted: a 6,642-contact send counts 6,642/20 times more than a 20-contact test,
// which is what "of every 100 e-mails sent, how many were opened" actually means.
export function summarize(campaigns: Campaign[]): Summary {
  const sent = campaigns.reduce((s, c) => s + c.send_amt, 0);
  const opens = campaigns.reduce((s, c) => s + c.uniqueopens, 0);
  const clicks = campaigns.reduce((s, c) => s + c.uniquelinkclicks, 0);
  return {
    count: campaigns.length,
    sent,
    open_rate: sent > 0 ? (opens / sent) * 100 : 0,
    ctr: sent > 0 ? (clicks / sent) * 100 : 0,
  };
}
