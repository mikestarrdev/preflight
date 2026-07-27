// One-click example ads for the empty state, verbatim from
// evals/dataset/realistic.jsonl so the demo output is known-good against the
// eval run in evals/REPORT.md. One clear violation, one hedge/borderline
// case, one clean ad (see REPORT.md section 8 for how each is scored).
export type ExampleAd = {
  id: string;
  label: string;
  copy: string;
};

export const EXAMPLE_ADS: ExampleAd[] = [
  {
    id: 'real-wl-2',
    label: 'Weight-loss coaching ad',
    copy: "Meet the metabolism coaching program built around your schedule, not the other way around. Weekly check-ins, a registered dietitian on call, and meals you'll actually look forward to. Here's our promise: follow the plan and you will lose 30 pounds in the next 30 days, no exceptions and no gimmicks. Spots in this month's cohort are limited and they fill fast. Reserve your place today and start seeing the scale move by next week.",
  },
  {
    id: 'real-adlib-kingdom-debt',
    label: 'Debt-relief ad',
    copy: "Are you a Christian with over $30,000 in credit card or personal loan debt?\n\nImagine lowering your monthly payments and cutting your total debt nearly in half — without taking out another loan, doing a balance transfer, or filing for bankruptcy.\n\nIt's ethical, legal, and inspired by Biblical wisdom. Yet most Christians never hear about it.\n\nInside our free Debt Negotiation Secrets Guide, you'll learn the exact steps thousands are using to walk toward financial freedom.\n\nTap below and download your free copy now.",
  },
  {
    id: 'real-adlib-bizjack',
    label: 'Productivity quiz ad',
    copy: "You open the laptop. You know exactly what needs to happen today. And somehow, two hours later, you've refreshed your email 14 times and done everything except THE thing.\n\nIt's not that you don't care. You care so much it keeps you up at 2am.\n\nIt's not that you don't know what to do. You know exactly what to do. You could probably teach it.\n\nAnd yet. Here you are. Again.\n\nYou've tried pushing harder.\nYou've tried getting up earlier.\nYou've tried the accountability partner, the planner, the \"this time I really mean it\" Monday reset.\n\nAnd it works... for a few days. Until it doesn't.\n\nSo you start quietly wondering if there's something wrong with you.\n\nIf success is just easier for other people. If you're the kind of person who always almost makes it.\n\nYou're not broken. And there's nothing wrong with you.\n\nBut something IS running quietly in the background... a subconscious pattern that was never designed to help you succeed. It was designed to keep you safe. And safe, to your brain, means exactly where you are.\n\nThis free 9-question quiz identifies your specific pattern in 60 seconds.\n\nOnce you know what it is, everything else starts to make sense and you can follow a couple really simple steps to make action effortless.\n\nBecause when consistent action is effortless... anything is possible!",
  },
];
