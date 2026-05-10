export type FightMethod = "KO/TKO" | "Submission" | "Decision";

interface FighterStyle {
  method: FightMethod;
  baseOdds: number;
}

const FIGHTER_STYLES: Record<string, FighterStyle> = {
  // ── Submission specialists ────────────────────────────────────────────────
  "Pat Sabatini":           { method: "Submission", baseOdds: 190 },
  "Jim Miller":             { method: "Submission", baseOdds: 215 },
  "Grant Dawson":           { method: "Submission", baseOdds: 205 },
  "Charles Oliveira":       { method: "Submission", baseOdds: 185 },
  "Islam Makhachev":        { method: "Submission", baseOdds: 170 },
  "Khamzat Chimaev":        { method: "Submission", baseOdds: 180 },
  "Usman Nurmagomedov":     { method: "Submission", baseOdds: 175 },
  "Benoit Saint Denis":     { method: "Submission", baseOdds: 200 },
  "Arman Tsarukyan":        { method: "Submission", baseOdds: 195 },
  "Nate Diaz":              { method: "Submission", baseOdds: 245 },
  "Tony Ferguson":          { method: "Submission", baseOdds: 235 },
  "Brian Ortega":           { method: "Submission", baseOdds: 195 },
  "Bryce Mitchell":         { method: "Submission", baseOdds: 205 },
  "Conor Heun":             { method: "Submission", baseOdds: 210 },
  "Jake Hadley":            { method: "Submission", baseOdds: 205 },
  "Johnny Walker":          { method: "Submission", baseOdds: 220 },
  "Demian Maia":            { method: "Submission", baseOdds: 185 },
  "Frank Mir":              { method: "Submission", baseOdds: 200 },
  "Gillian Robertson":      { method: "Submission", baseOdds: 195 },
  "Mackenzie Dern":         { method: "Submission", baseOdds: 195 },
  "Marina Rodriguez":       { method: "Submission", baseOdds: 215 },
  "Matt Frevola":           { method: "Submission", baseOdds: 220 },
  "Leandro Silva":          { method: "Decision",   baseOdds: 160 },
  "Clay Guida":             { method: "Decision",   baseOdds: 145 },
  "Alan Baudot":            { method: "Submission", baseOdds: 210 },

  // ── KO / TKO specialists ──────────────────────────────────────────────────
  "Tom Aspinall":           { method: "KO/TKO", baseOdds: 160 },
  "Sergei Pavlovich":       { method: "KO/TKO", baseOdds: 155 },
  "Francis Ngannou":        { method: "KO/TKO", baseOdds: 145 },
  "Ciryl Gane":             { method: "KO/TKO", baseOdds: 185 },
  "Jon Jones":              { method: "KO/TKO", baseOdds: 175 },
  "Alex Pereira":           { method: "KO/TKO", baseOdds: 168 },
  "Israel Adesanya":        { method: "KO/TKO", baseOdds: 185 },
  "Dricus du Plessis":      { method: "KO/TKO", baseOdds: 185 },
  "Sean O'Malley":          { method: "KO/TKO", baseOdds: 195 },
  "Conor McGregor":         { method: "KO/TKO", baseOdds: 160 },
  "Dustin Poirier":         { method: "KO/TKO", baseOdds: 190 },
  "Justin Gaethje":         { method: "KO/TKO", baseOdds: 175 },
  "William Gomis":          { method: "KO/TKO", baseOdds: 195 },
  "Roman Kopylov":          { method: "KO/TKO", baseOdds: 185 },
  "Mateusz Rebecki":        { method: "KO/TKO", baseOdds: 190 },
  "Robert Whittaker":       { method: "KO/TKO", baseOdds: 195 },
  "Paddy Pimblett":         { method: "KO/TKO", baseOdds: 190 },
  "Jailton Almeida":        { method: "KO/TKO", baseOdds: 175 },
  "Khalil Rountree":        { method: "KO/TKO", baseOdds: 175 },
  "Carlos Ulberg":          { method: "KO/TKO", baseOdds: 185 },
  "Magomed Ankalaev":       { method: "KO/TKO", baseOdds: 195 },
  "Jamahal Hill":           { method: "KO/TKO", baseOdds: 190 },
  "Yair Rodriguez":         { method: "KO/TKO", baseOdds: 195 },
  "Max Holloway":           { method: "KO/TKO", baseOdds: 190 },
  "Arnold Allen":           { method: "KO/TKO", baseOdds: 210 },
  "Diego Lopes":            { method: "KO/TKO", baseOdds: 195 },
  "Ilia Topuria":           { method: "KO/TKO", baseOdds: 165 },
  "Dan Hooker":             { method: "KO/TKO", baseOdds: 195 },
  "Pedro Munhoz":           { method: "KO/TKO", baseOdds: 200 },
  "Curtis Blaydes":         { method: "KO/TKO", baseOdds: 185 },
  "Marco Tulio Silva":      { method: "KO/TKO", baseOdds: 195 },
  "Brendan Allen":          { method: "KO/TKO", baseOdds: 185 },
  "Joe Pyfer":              { method: "KO/TKO", baseOdds: 175 },
  "Michał Oleksiejczuk":    { method: "KO/TKO", baseOdds: 190 },
  "Andre Petroski":         { method: "KO/TKO", baseOdds: 195 },
  "Anthony Smith":          { method: "KO/TKO", baseOdds: 200 },
  "Tyson Pedro":            { method: "KO/TKO", baseOdds: 195 },
  "Devin Clark":            { method: "KO/TKO", baseOdds: 205 },
  "Mike Malott":            { method: "KO/TKO", baseOdds: 190 },
  "Kevin Holland":          { method: "KO/TKO", baseOdds: 195 },
  "Santiago Ponzinibbio":   { method: "KO/TKO", baseOdds: 195 },
  "Michael Morales":        { method: "KO/TKO", baseOdds: 185 },
  "Reinier de Ridder":      { method: "KO/TKO", baseOdds: 195 },
  "Sean Strickland":        { method: "KO/TKO", baseOdds: 200 },
  "Bo Nickal":              { method: "Submission", baseOdds: 185 },
  "Raul Rosas Jr":          { method: "Submission", baseOdds: 195 },
  "Veronica Hardy":         { method: "KO/TKO", baseOdds: 200 },
  // ── Boxing — tonight's card + upcoming headliners ────────────────────────
  "Fabio Wardley":          { method: "KO/TKO", baseOdds: 175 },
  "Daniel Dubois":          { method: "KO/TKO", baseOdds: 170 },
  "Serhii Bohachuk":        { method: "KO/TKO", baseOdds: 175 },
  "Shane Mosley Jr":        { method: "Decision", baseOdds: 160 },
  "Andreas Katzourakis":    { method: "Decision", baseOdds: 165 },
  "Misael Rodriguez Olivas":{ method: "KO/TKO", baseOdds: 190 },
  "Julian Rodriguez":       { method: "KO/TKO", baseOdds: 165 },
  "James Perella":          { method: "Decision", baseOdds: 175 },
  "Emanuel Odiase":         { method: "KO/TKO", baseOdds: 175 },
  "Nick Webb":              { method: "Decision", baseOdds: 185 },
  "Karen Chukhadzhian":     { method: "KO/TKO", baseOdds: 190 },
  "Paddy Donovan":          { method: "KO/TKO", baseOdds: 185 },
  "David Allen":            { method: "Decision", baseOdds: 170 },
  "Filip Hrgović":          { method: "KO/TKO", baseOdds: 175 },
  "Brian Norman Jr":        { method: "KO/TKO", baseOdds: 170 },
  "Josh Wagner":            { method: "Decision", baseOdds: 185 },
  "Keyshawn Davis":         { method: "KO/TKO", baseOdds: 175 },
  "Nahir Albright":         { method: "Decision", baseOdds: 190 },
  "Hamzah Sheeraz":         { method: "KO/TKO", baseOdds: 168 },
  "Alem Begic":             { method: "Decision", baseOdds: 185 },
  "Mizuki Hiruta":          { method: "Decision", baseOdds: 155 },
  "Mai Soliman":            { method: "Decision", baseOdds: 175 },
  "Oleksandr Usyk":         { method: "Decision", baseOdds: 145 },
  "Rico Verhoeven":         { method: "KO/TKO", baseOdds: 175 },
  "O'Shaquie Foster":       { method: "KO/TKO", baseOdds: 195 },
  "Raymond Ford":           { method: "Decision", baseOdds: 160 },
  "Amanda Serrano":         { method: "KO/TKO", baseOdds: 175 },
  "Cheyenne Hanson":        { method: "Decision", baseOdds: 190 },
  "Stephanie Han":          { method: "KO/TKO", baseOdds: 180 },
  "Holly Holm":             { method: "Decision", baseOdds: 155 },
  "Albert Ramirez":         { method: "KO/TKO", baseOdds: 175 },
  "Lerrone Richards":       { method: "Decision", baseOdds: 155 },
  "Galal Yafai":            { method: "KO/TKO", baseOdds: 185 },
  "Ricardo Rafael Sandoval":{ method: "KO/TKO", baseOdds: 180 },
  "Jesse Rodriguez":        { method: "KO/TKO", baseOdds: 170 },
  "Antonio Vargas":         { method: "Decision", baseOdds: 180 },
  "Jaron Ennis":            { method: "KO/TKO", baseOdds: 170 },
  "Xander Zayas":           { method: "Decision", baseOdds: 170 },
  "Ryan Garner":            { method: "KO/TKO", baseOdds: 175 },
  "Michael Magnesi":        { method: "Decision", baseOdds: 165 },
  "Anthony Joshua":         { method: "KO/TKO", baseOdds: 165 },
  "Tyson Fury":             { method: "KO/TKO", baseOdds: 165 },
  // ── Boxing classics ──────────────────────────────────────────────────────
  "Canelo Alvarez":         { method: "KO/TKO", baseOdds: 175 },
  "Gervonta Davis":         { method: "KO/TKO", baseOdds: 155 },
  "Ryan Garcia":            { method: "KO/TKO", baseOdds: 165 },
  "Errol Spence Jr":        { method: "KO/TKO", baseOdds: 175 },
  "Terence Crawford":       { method: "KO/TKO", baseOdds: 175 },
  "Jermell Charlo":         { method: "KO/TKO", baseOdds: 175 },
  "David Benavidez":        { method: "KO/TKO", baseOdds: 165 },
  "Vergil Ortiz Jr":        { method: "KO/TKO", baseOdds: 170 },
  "Dmitry Bivol":           { method: "Decision", baseOdds: 145 },
  "Artur Beterbiev":        { method: "KO/TKO", baseOdds: 155 },

  // ── Decision grinders ────────────────────────────────────────────────────
  "Colby Covington":        { method: "Decision", baseOdds: 145 },
  "Kamaru Usman":           { method: "Decision", baseOdds: 165 },
  "Leon Edwards":           { method: "Decision", baseOdds: 155 },
  "Belal Muhammad":         { method: "Decision", baseOdds: 140 },
  "Merab Dvalishvili":      { method: "Decision", baseOdds: 150 },
  "Movsar Evloev":          { method: "Decision", baseOdds: 155 },
  "Jack Della Maddalena":   { method: "Decision", baseOdds: 165 },
  "Ian Machado Garry":      { method: "Decision", baseOdds: 170 },
  "Geoff Neal":             { method: "Decision", baseOdds: 175 },
  "Neil Magny":             { method: "Decision", baseOdds: 160 },
  "Bryan Battle":           { method: "Decision", baseOdds: 170 },
  "Mike Davis":             { method: "Decision", baseOdds: 175 },
  "Devin Haney":            { method: "Decision", baseOdds: 145 },
  "Caleb Plant":            { method: "Decision", baseOdds: 155 },
};

/**
 * Transform a raw h2h moneyline leg into a fight-method leg.
 * If the fighter is in the style DB, uses their primary finishing method.
 * Unknown fighters default to Decision.
 */
export function buildFightMethodLeg(leg: {
  gameId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  pick: string;
  odds: number;
  bookmaker?: string;
  confidence?: number;
  edge?: number;
}): {
  gameId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  pick: string;
  betType: string;
  bookmaker: string;
  odds: number;
  confidence?: number;
  edge?: number;
  reasoning?: string;
} {
  const name = leg.pick.trim();
  const style = FIGHTER_STYLES[name];
  const method: FightMethod = style?.method ?? "Decision";
  let odds = style?.baseOdds ?? 175;

  // Heavier favorites finish more convincingly → tighter method odds
  if (leg.odds < -250) odds = Math.max(odds - 35, 115);
  else if (leg.odds < -175) odds = Math.max(odds - 20, 125);
  else if (leg.odds < -120) odds = Math.max(odds - 10, 130);

  const methodLabels: Record<FightMethod, string> = {
    "KO/TKO":     "KO or TKO",
    "Submission": "Submission",
    "Decision":   "Decision",
  };

  return {
    gameId:    leg.gameId,
    sport:     leg.sport,
    homeTeam:  leg.homeTeam,
    awayTeam:  leg.awayTeam,
    startTime: leg.startTime,
    pick:      `${name} to win by ${methodLabels[method]}`,
    betType:   "fight_method",
    bookmaker: leg.bookmaker ?? "DraftKings",
    odds,
    confidence: leg.confidence,
    edge:       leg.edge,
    reasoning:  `${name} has a strong tendency to finish fights via ${methodLabels[method].toLowerCase()}. Method pick offers better value than the straight moneyline.`,
  };
}
