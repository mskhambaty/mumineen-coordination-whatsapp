// Bilingual source of truth for the Ashara 1448H knowledge quiz (15 questions).
//
// QUESTIONS LIVE HERE, not in the DB — translations are "fed in" by filling each question's `ld`
// (Lisan ud Dawat) block from the translator's spreadsheet. English is authoritative; `ld` is null
// until translated, and the UI simply falls back to English when a question's `ld` is missing.
//
// Each question's options are authored with the CORRECT one first (correctIndex 0); the public page
// shuffles option order per session for display, so the answer is never visually "always first".
// Grading is done server-side against correctIndex (see grading.ts) — the stored score is authoritative.

export const QUIZ_KEY = "ashara-1448h";
export const QUIZ_TITLE_EN = "Ashara Mubaraka 1448H — Knowledge Quiz";
export const QUIZ_TITLE_LD = "عشرہ مبارکہ ١٤٤٨ھ — علم کوئز";

export type QuizLang = {
  question: string;
  options: [string, string, string, string];
  explanation: string;
};

export type QuizQuestion = {
  id: string;
  majlis: string;
  majlisLd: string;
  correctIndex: number; // index into the AUTHORED options order (en.options / ld.options)
  en: QuizLang;
  ld: QuizLang | null; // fed in from the translation sheet; null = use English
};

export const QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    id: "q1",
    majlis: "Majlis 1 · Clothing & food",
    majlisLd: "مجلس ١ · لباس انے کهانو",
    correctIndex: 0,
    en: {
      question:
        "When Maulana Ali AS and Maulatona Fatema AS fed a hungry guest with barely a ratal of wheat, Ali AS kept the lamp dim and only appeared to eat. Why?",
      options: [
        "So the guest could eat his fill without embarrassment",
        "To make the little food last longer",
        "To hide their poverty",
        "To save lamp oil",
      ],
      explanation:
        "True generosity guards the other person's dignity — like sweat-proof clothing that spares others discomfort.",
    },
    ld: null,
  },
  {
    id: "q2",
    majlis: "Majlis 1 · Clothing & food",
    majlisLd: "مجلس ١ · لباس انے کهانو",
    correctIndex: 0,
    en: {
      question:
        "Of the six traits shared by a tailor and a cook, 'cutting away the excess' (scissors and knife) taught believers to —",
      options: [
        "Cut away what is harmful — wastage of food, and whatever compromises the faith (as Syedna Abdeali Saifuddin RA refused interest)",
        "Gauge each person's temperament before dealing with them",
        "Offer warmth or a cold shoulder according to the season",
        "Mend a torn relationship so skilfully the tear cannot be seen",
      ],
      explanation:
        "Cutting away the excess means removing wastage and whatever harms the faith — Syedna Abdeali Saifuddin RA cut off an interest-based loan at once.",
    },
    ld: null,
  },
  {
    id: "q3",
    majlis: "Majlis 1 · Clothing & food",
    majlisLd: "مجلس ١ · لباس انے کهانو",
    correctIndex: 0,
    en: {
      question:
        "When Abu Talha's son died while he was away, his wife withheld the news, served him a meal, then asked: 'What of one who wails when returning a trust (amanat)?' What was she teaching?",
      options: [
        "Their son was Allah's amanat, now reclaimed — so they should not grieve foolishly",
        "That a wife should always shield her husband from painful news",
        "That patience means never showing one's grief",
        "That a trust must be returned the moment it is asked for",
      ],
      explanation:
        "The skilful 'repair' of a grieving heart — reframing loss as a trust returned to its Owner.",
    },
    ld: null,
  },
  {
    id: "q4",
    majlis: "Majlis 2 · Information technology",
    majlisLd: "مجلس ٢ · انفارميشن ٹيکنالوجي",
    correctIndex: 0,
    en: {
      question:
        "Syedi Hasanfeer QR had a king swap thrones and robes with him to explain 'a camel passing through the eye of a needle.' Its real meaning?",
      options: [
        "A person of great standing humbling himself before Allah, casting off pride",
        "That worldly rank counts for nothing in the hereafter",
        "That the rich face a harder reckoning than the poor",
        "That salvation requires giving away all one owns",
      ],
      explanation:
        "The 'impossible' becomes possible when the mighty cast aside hubris and submit with humility.",
    },
    ld: null,
  },
  {
    id: "q5",
    majlis: "Majlis 2 · Information technology",
    majlisLd: "مجلس ٢ · انفارميشن ٹيکنالوجي",
    correctIndex: 0,
    en: {
      question: "In the word Safina, the letter Noon (noor / light) stood for which quality of IT?",
      options: ["Speed", "User-friendliness", "Discernment", "Lifelong learning"],
      explanation:
        "Light travels ~300 million m/s — symbolising high-speed performance, and accepting the Awliya's directives swiftly.",
    },
    ld: null,
  },
  {
    id: "q6",
    majlis: "Majlis 3 · Architecture & engineering",
    majlisLd: "مجلس ٣ · فنِ تعمير",
    correctIndex: 0,
    en: {
      question: "The waaz framed a masjid by its seven hudood. What are they?",
      options: [
        "The land, the four walls, the roof, and the air within",
        "The foundation, four pillars, the dome, and the mihrab",
        "The mihrab, the minbar, the four walls, and the dome",
        "The land, the courtyard, two walls, the roof, and the minaret",
      ],
      explanation:
        "From a bayaan of Syedna Ja'far bin Mansur al-Yemen RA — each hadd carries a lesson for life and for raising children.",
    },
    ld: null,
  },
  {
    id: "q7",
    majlis: "Majlis 3 · Architecture & engineering",
    majlisLd: "مجلس ٣ · فنِ تعمير",
    correctIndex: 0,
    en: {
      question: "What did Syedna identify as the foundation of every endeavour (the 'first wall')?",
      options: ["Tawakkul (trust in Allah)", "Wealth", "Strength", "Knowledge alone"],
      explanation:
        "Jibraeel AS brought the Hajar-e-Aswad while Ismail AS searched — Allah needs no toil of creation; tawakkul is the foundation.",
    },
    ld: null,
  },
  {
    id: "q8",
    majlis: "Majlis 4 · Lawyers & doctors",
    majlisLd: "مجلس ٤ · وکيل انے ڈاکٹر",
    correctIndex: 0,
    en: {
      question:
        "Imam Ja'far al-Sadiq AS taught that Allah created no sharr — even weevils in grain are khayr. How so?",
      options: [
        "Fear of pests stops rulers hoarding grain, keeping food cheap and within reach",
        "Weevils test our patience",
        "They are food for the birds",
        "They remind us of death",
      ],
      explanation:
        "The 'sehr-e-halal' of the Awliya — inverting a firmly-held but mistaken belief through reason.",
    },
    ld: null,
  },
  {
    id: "q9",
    majlis: "Majlis 4 · Lawyers & doctors",
    majlisLd: "مجلس ٤ · وکيل انے ڈاکٹر",
    correctIndex: 0,
    en: {
      question:
        "Abu Hanifa doubted whether Imam Ja'far al-Sadiq's AS staff was truly Rasul Allah's SAW. How did the Imam answer?",
      options: [
        "He bared his arm: 'You doubt the staff — do you doubt this blood and flesh is his?'",
        "He recited the chain of narrators back to Rasul Allah SAW",
        "He replied that a true believer needs no proof at all",
        "He challenged Abu Hanifa to prove it false",
      ],
      explanation:
        "Logic, discernment and firmness in one reply — the Imam's own being is the strongest proof.",
    },
    ld: null,
  },
  {
    id: "q10",
    majlis: "Majlis 5 · Me'raj & the kalima",
    majlisLd: "مجلس ٥ · معراج انے کلمو",
    correctIndex: 0,
    en: {
      question: "Uttering the kalima protects one's life and property — but what makes it a means to jannat?",
      options: [
        "Professing it with ikhlaas (sincere, pure intent)",
        "Saying it aloud",
        "Saying it in Arabic",
        "Repeating it daily",
      ],
      explanation: "al-hasanat (good) is the love of Wali Allah AS; al-sayyiaat (evil) is enmity toward him.",
    },
    ld: null,
  },
  {
    id: "q11",
    majlis: "Majlis 6 · Qualities of a teacher",
    majlisLd: "مجلس ٦ · معلّم ني صفتو",
    correctIndex: 0,
    en: {
      question: "Hasan AS and Husain AS saw a shaikh making wudhu incorrectly. How did they correct him?",
      options: [
        "They asked him to judge their wudhu, so he saw his own mistake — without being shamed",
        "They performed wudhu beside him so he could copy the correct way",
        "They taught the rules of wudhu to everyone present without naming him",
        "They asked Rasul Allah SAW to gently correct him",
      ],
      explanation:
        "Correct with humility — 'lower your wing to the believers' (15:88) — elevate, do not embarrass.",
    },
    ld: null,
  },
  {
    id: "q12",
    majlis: "Majlis 7 · Business (tijarat)",
    majlisLd: "مجلس ٧ · تجارت",
    correctIndex: 0,
    en: {
      question: "Majlis 7 (Business) opened with which Quranic theme?",
      options: [
        "Allah has 'purchased' Mumineen's lives and wealth in exchange for jannat",
        "The story of Yusuf AS",
        "The splitting of the moon",
        "The creation of Adam AS",
      ],
      explanation:
        "'Allah has purchased the believers' lives and wealth, that theirs shall be jannat' (9:111) — the most profitable trade.",
    },
    ld: null,
  },
  {
    id: "q13",
    majlis: "Majlis 7 · Business (tijarat)",
    majlisLd: "مجلس ٧ · تجارت",
    correctIndex: 0,
    en: {
      question:
        "'If people truly trusted Allah, He would provide as He provides the birds — who leave hungry at dawn and return full at dusk.' This teaches —",
      options: [
        "Tawakkul: trade in the halal, trusting Allah as the true Provider",
        "That one need not work",
        "That wealth comes without effort",
        "To give away all earnings",
      ],
      explanation: "Effort plus trust: the birds still fly out — but it is Allah who fills them.",
    },
    ld: null,
  },
  {
    id: "q14",
    majlis: "Majlis 7 · Business (tijarat)",
    majlisLd: "مجلس ٧ · تجارت",
    correctIndex: 0,
    en: {
      question:
        "In Dai Abu Sufyan's QR riwayat, a man bought a camel with only 'Allah' as guarantor, then defaulted. What happened?",
      options: [
        "The camel broke free and returned laden with dates — Allah fulfilling the guarantee",
        "The man was punished",
        "The dai forgave the debt",
        "The camel was never seen again",
      ],
      explanation:
        "The contrite man later paid in full; the dai, easy in dealing, kept only what was owed — sahl al-bay'.",
    },
    ld: null,
  },
  {
    id: "q15",
    majlis: "Majlis 8 · Siyasat / governance",
    majlisLd: "مجلس ٨ · سياست",
    correctIndex: 0,
    en: {
      question:
        "Majlis 8 honoured Imam Hasan AS with the topic of siyasat. How many types of siyasat were expounded?",
      options: ["Five", "Three", "Nine", "Seven"],
      explanation:
        "From Imam Ahmed al-Mastur's AS Rasa'il Ikhwan al-Safa: Nabawiyya, Mulukiyya, 'Aamma, Khaassa, Zaatiyya.",
    },
    ld: null,
  },
];

export function getQuestion(id: string): QuizQuestion | undefined {
  return QUIZ_QUESTIONS.find((q) => q.id === id);
}
