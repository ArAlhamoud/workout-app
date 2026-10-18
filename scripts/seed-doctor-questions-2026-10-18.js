#!/usr/bin/env node
/**
 * One-off (2026-10-18): the owner's eight questions for the cardiology
 * visit, written onto the profile (HealthProfile.doctorQuestions) in HIS
 * words — the doctor report prints them, open ones only, as its last
 * section. Also the birth month he gave (June 1988, day unknown → stored
 * as the 15th, printed "June 1988 · 38 y"), set only while the column is
 * still empty.
 *
 * Refuses if the profile already holds ANY question: this is a seed, not
 * a merge — later questions are added on /health/plan. Idempotent on the
 * birth date (a stored date is never overwritten).
 *
 * DRY RUN IS THE DEFAULT.
 *   node scripts/seed-doctor-questions-2026-10-18.js           # preview
 *   node scripts/seed-doctor-questions-2026-10-18.js --apply   # write
 */
const APPLY = process.argv.includes('--apply');

const CREATED_AT = '2026-10-18T00:00:00.000Z';
const BIRTH_DATE = new Date('1988-06-15T00:00:00.000Z');

const TEXTS = [
  "My CRP was 33.8 on 12 Oct and still 27.2 on 15 Oct, with troponin 0.8 and ESR 8. What's causing it? Should I repeat the CRP and have an echo?",
  'What exactly did the 12 Oct ECG show? The doctor said "variability".',
  'My resting heart rate has been 85–95 in the evenings, up to 117. Is that the inflammation?',
  'A Watch ECG on 16 Oct showed one early beat. Does that matter on flecainide? (bring the PDF)',
  'When can I go back to the gym, and how gradually?',
  "What's my stroke-risk score, and do I need a blood thinner? (AF, treated high blood pressure, both parents had strokes)",
  'LDL went from 4.54 to 3.4, but HDL is 1.0 and my parents had strokes. Do I need a cholesterol medicine, or should I wait for more weight loss?',
  'Which method would you use (pulsed-field ablation)?',
];

const QUESTIONS = TEXTS.map((text, i) => ({
  id: `q-2026-10-18-${i + 1}`,
  text,
  for: 'cardiology',
  askedOn: null,
  answer: null,
  createdAt: CREATED_AT,
}));

/** The same read the app does: a well-formed entry is a question. */
const countStored = (raw) =>
  Array.isArray(raw) ? raw.filter((q) => q && typeof q === 'object' && typeof q.text === 'string' && q.text.trim()).length : 0;

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const profile = await prisma.healthProfile.findUnique({
    where: { id: 'profile' },
    select: { doctorQuestions: true, birthDate: true },
  });

  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — questions for the doctor`);
  if (!profile) {
    console.error('REFUSING: no health profile row.');
    await prisma.$disconnect();
    process.exit(1);
  }
  const stored = countStored(profile.doctorQuestions);
  console.log(`Stored questions: ${stored}`);
  console.log(`Stored birth date: ${profile.birthDate ? profile.birthDate.toISOString().slice(0, 10) : '(none)'}`);
  console.log(`To write (${QUESTIONS.length}, all cardiology, created ${CREATED_AT.slice(0, 10)}):`);
  QUESTIONS.forEach((q) => console.log(`  ${q.id}: ${q.text}`));
  const setBirth = !profile.birthDate;
  console.log(setBirth ? `Birth date to write: ${BIRTH_DATE.toISOString().slice(0, 10)} (June 1988, day unknown)` : 'Birth date: kept as stored.');

  if (stored > 0) {
    console.error(`REFUSING: the profile already holds ${stored} question(s). Add more on /health/plan.`);
    await prisma.$disconnect();
    process.exit(1);
  }
  if (!APPLY) {
    console.log('Dry run — nothing written. Re-run with --apply.');
    await prisma.$disconnect();
    return;
  }
  await prisma.healthProfile.update({
    where: { id: 'profile' },
    data: { doctorQuestions: QUESTIONS, ...(setBirth ? { birthDate: BIRTH_DATE } : {}) },
  });
  console.log('Written.');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
