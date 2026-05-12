const DEFAULT_TAGLINE = 'Your workspace, your way.';

const HOLIDAY_TAGLINES = {
  newYear: "New year, new workspace—this time the side projects actually ship.",
  valentines: "Roses are red, terminals are dark, your workspace is waiting with a blinking cursor heart.",
  stPatricks: "May your builds be green, your logs be clean, and your deploys land where you mean.",
  aprilFools: "This terminal has mass: it bends time, light, and deadlines around it.",
  halloween: "Spooky season: haunted processes, cursed configs, and the ghost of node_modules past.",
  christmas: "Santa uses codexmux—how else would he manage a billion deliveries in one night?",
} as const;

const TAGLINES: string[] = [
  // workspace & terminal
  "Your terminal, tuned for Codex.",
  "Where ideas compile and side projects actually ship.",
  "Hot reload for configs, cold sweat for deploys.",
  "Finally, a terminal that matches your aesthetic ambitions.",
  "Somewhere between 'hello world' and 'oh god what have I built.'",
  "Making 'I'll automate that later' happen now.",
  "The terminal experience you deserve, not the one you're used to.",
  "Less clicking, more shipping, fewer 'where did that terminal go' moments.",
  "Running on your machine. Judging your aliases. Silently.",
  "Ship code, not excuses.",
  "One workspace to rule them all.",
  "Built for people who think in terminals.",
  "Productivity wrapped in focus.",
  "The only app where splitting things makes you more productive.",
  "Because alt-tabbing between 12 terminals is not a personality.",
  "Works on my machine. And now, beautifully.",
  "A terminal so nice you'll forget it's a terminal.",
  "Ctrl+C your old workflow. Ctrl+V into something better.",
  "Where every pixel earns its keep.",
  "You had me at 'codexwinmux'.",
  "All your sessions in one place. Finally.",
  // vibe coding
  "Vibe coding: where the cursor moves and the code just happens.",
  "Skip the boilerplate. Ride the vibe.",
  "Less typing, more vibing. That's the workflow now.",
  "The best code is the code you didn't have to write.",
  // agent
  "Humans steer, agents execute. You're the pilot.",
  "Your agent is ready. Just say what you need.",
  "Codex is ready when you are.",
  "Like having a senior engineer on call—minus the sighing.",
  "Your AI pair programmer's favorite workspace.",
  "The agent does the work. You take the credit.",
  "One prompt away from 'it just works.'",
  // taste & craft
  "In the age of AI, taste is your superpower.",
  "AI writes the code. You bring the taste.",
  "Good defaults, better aesthetics, zero compromises.",
  "Your dev environment, minus the existential dread.",
  // thin client
  "Terminal, CLI, markdown. Everything else is noise.",
  "Thin client energy. Thick productivity.",
  "Crafted for Codex sessions that stay organized.",
  "A focused workspace for serious agent work.",
];

const DAY_MS = 24 * 60 * 60 * 1000;

type THolidayRule = (date: Date) => boolean;

const utcParts = (date: Date) => ({
  year: date.getUTCFullYear(),
  month: date.getUTCMonth(),
  day: date.getUTCDate(),
});

const onMonthDay =
  (month: number, day: number): THolidayRule =>
  (date) => {
    const p = utcParts(date);
    return p.month === month && p.day === day;
  };

const inRange =
  (month: number, startDay: number, endDay: number): THolidayRule =>
  (date) => {
    const p = utcParts(date);
    return p.month === month && p.day >= startDay && p.day <= endDay;
  };

const isFourthThursdayOfNovember: THolidayRule = (date) => {
  const p = utcParts(date);
  if (p.month !== 10) return false;
  const firstDay = new Date(Date.UTC(p.year, 10, 1)).getUTCDay();
  const offset = (4 - firstDay + 7) % 7;
  return p.day === 1 + offset + 21;
};

const HOLIDAY_RULES = new Map<string, THolidayRule>([
  [HOLIDAY_TAGLINES.newYear, onMonthDay(0, 1)],
  [HOLIDAY_TAGLINES.valentines, onMonthDay(1, 14)],
  [HOLIDAY_TAGLINES.stPatricks, onMonthDay(2, 17)],
  [HOLIDAY_TAGLINES.aprilFools, onMonthDay(3, 1)],
  [HOLIDAY_TAGLINES.halloween, onMonthDay(9, 31)],
  [HOLIDAY_TAGLINES.christmas, inRange(11, 24, 25)],
]);

const ALL_TAGLINES = [
  ...TAGLINES,
  ...Object.values(HOLIDAY_TAGLINES),
];

const isTaglineActive = (tagline: string, date: Date): boolean => {
  const rule = HOLIDAY_RULES.get(tagline);
  return rule ? rule(date) : true;
};

export const pickTagline = (now: Date = new Date()): string => {
  const pool = ALL_TAGLINES.filter((t) => isTaglineActive(t, now));
  const active = pool.length > 0 ? pool : TAGLINES;
  return active[Math.floor(Math.random() * active.length)] ?? DEFAULT_TAGLINE;
};

export const pickTaglines = (count: number, now: Date = new Date()): string[] => {
  const pool = ALL_TAGLINES.filter((t) => isTaglineActive(t, now));
  const active = pool.length > 0 ? pool : TAGLINES;
  const shuffled = [...active].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
};
