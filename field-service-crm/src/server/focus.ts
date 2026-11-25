// Owner's daily focus: 3 business tasks a day toward $10k/month, sent to Telegram by the daily cron.
// Every task is an action from the mandala chart and names its pillar. The mandala page/PDF in ~/Claude0/routine is built from this file.

export const GOAL = "$10k/month · Solid Landscaping · by May 2027";

// 8 pillars × 8 actions (the mandala chart). General habits and standards, not one-off errands.
// Pillars cover the skills (leads, sales, offer, delivery, reputation, systems) and, as in Ohtani's chart, the inner game (mindset, character & luck).
export const PILLARS: [string, string[]][] = [
  ["Lead flow", ["Call 5 past clients every week", "Ask every happy client for a referral", "Postcards to the neighbours of every job", "Contact 10 realtors or partners a week", "3 local Facebook group posts a week", "Post 1 short video a day", "Google profile post + photos every week", "Master one channel before adding the next"]],
  ["Sales & follow-up", ["Reply to every lead within 1 hour", "Site visit within 72 hours", "Quote within 48 hours of the visit", "Walkthrough video with every quote", "Matching photos + reviews with every quote", "8–9 touches until a yes, a no or a date", "Ask every \"no\" why, and write it down", "Practise the sales script every week"]],
  ["Offer & pricing", ["Sell the finished yard, not the stones", "A design render with every quote", "A written guarantee you can keep", "Raise prices every season", "Know the margin on every job", "Book next season early, with a deposit", "Offer one add-on on every quote", "Written estimate on every job"]],
  ["Delivery & quality", ["Start and finish on the date promised", "Proper base and drainage, every job", "Clean the site every evening", "Before/after photos of every job", "Update the client daily during a job", "Final walkthrough with the client", "Fix any problem within 48 hours", "Check in 30 days after every job"]],
  ["Reputation & reviews", ["Ask every client for a Google review", "Reply to every review within 24 hours", "Same name, phone, website everywhere", "1 new directory listing a week until done", "A case study for every finished job", "1 website improvement a week", "Rewrite low-click titles every month", "Yard sign at every job"]],
  ["Systems & numbers", ["Every lead in the CRM the same day", "Clear CRM follow-ups every day", "Weekly numbers: leads, quotes, close rate, $", "Cost per job by lead source", "Monthly money check: revenue, costs, profit", "Templates for quotes, texts and emails", "A checklist for every repeat task", "Sunday: plan the week's 21 tasks"]],
  ["Mindset", ["Read the goal and its date every morning", "The 3 tasks before anything else", "Volume beats luck: more calls, more quotes", "Fix one constraint at a time", "Learn from every lost quote, no blame", "Learn on the commute: books, podcasts", "Weekly review: what worked, what didn't", "Do the boring thing for longer"]],
  ["Character & luck", ["On time, every time", "Answer every call, return every message", "Honest prices, honest work", "Thank every client, worker and supplier", "Respect your uncle and the crew", "Keep the truck and tools clean", "Help a client or neighbour unasked, weekly", "Pick up trash you walk past"]],
];

type Task = [pillar: number, text: string];

// The 3 tasks for each weekday (0 = Sunday). Every task is an action from the chart.
export const WEEK: Task[][] = [
  [[6, "Weekly review: what worked, what didn't"], [5, "Plan next week's 21 tasks"], [6, "30 min learning: sales, offers or marketing"]],
  [[0, "Call 5 past clients: referral, review, next-season work"], [4, "Google profile post + photos"], [0, "Contact 5 realtors or partners"]],
  [[0, "Edit + schedule this week's videos"], [1, "Every open quote to a yes, a no or a date"], [4, "Ship 1 website improvement"]],
  [[0, "3 local Facebook group posts"], [4, "Ask 3 past clients for a Google review"], [4, "Add 1 directory listing"]],
  [[0, "Prep postcards for the next street"], [0, "Contact 5 realtors or partners"], [2, "Improve the offer: price list, guarantee or add-ons"]],
  [[5, "Clear every CRM follow-up"], [5, "Write the week's numbers: leads, quotes, close rate, $"], [1, "15 min sales script practice"]],
  [[0, "Site visits + deliver this week's postcards"], [0, "Batch-film 6 short videos"], [0, "Knock 10 doors around a past job"]],
];

export function focusFor(date: string): Task[] {
  const [y, m, d] = date.split("-").map(Number);
  return WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function focusMessage(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const lines = focusFor(date).map(([p, t], i) => `${i + 1}. ${t}\n    ↳ ${PILLARS[p][0]}`);
  return `🎯 3 tasks · ${day}\n\n${lines.join("\n\n")}\n\nGoal: ${GOAL}. Put them in your calendar, do them before anything else.`;
}
