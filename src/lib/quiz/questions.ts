// Bilingual source of truth for the Ashara 1448H knowledge quiz (15 questions).
//
// QUESTIONS LIVE HERE, not in the DB. English (`en`) is authoritative. Each question's `ld`
// (Lisan ud Dawat) block holds the translator's text for the QUESTION and OPTIONS (imported from
// `ashara quiz with lisan ud dawah.xlsx`), typed in the Kanz al-Marjaan input scheme — it renders
// correctly only in that font (the `.lisan` class on the page). The translator did NOT translate
// the explanations, so `ld.explanation` is left empty and the page always shows the English
// `en.explanation` (the "lesson" stays English, like the clue/hint). The UI also falls back to
// English for the whole question whenever a `ld` block is null.
//
// Each `QuizLang` carries a `hint`; the on-page "clue" always shows the English `en.hint`.
//
// Options are authored with the CORRECT one first (correctIndex 0); the public page shuffles option
// order per session so the answer is never visually "always first". Grading is server-side against
// correctIndex (see grading.ts) — the stored score is authoritative.

export const QUIZ_KEY = "ashara-1448h";
export const QUIZ_TITLE_EN = "Ashara Mubarakah 1448H Quiz";
export const QUIZ_TITLE_LD = "عشرہ مبارکہ ١٤٤٨ھ — علم کوئز";

export type QuizLang = {
  question: string;
  options: [string, string, string, string];
  explanation: string;
  hint: string;
};

export type QuizQuestion = {
  id: string;
  majlis: string;
  majlisLd: string;
  correctIndex: number; // index into the AUTHORED options order (en.options / ld.options)
  en: QuizLang;
  ld: QuizLang | null; // AI placeholder translation; replace with the translator's final text
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
        "So it doesn't feel too hot",
        "To save lamp oil",
      ],
      explanation:
        "True generosity guards the other person's dignity — like sweat-proof clothing that spares others discomfort.",
      hint: "Think about the guest's feelings, not the food.",
    },
    ld: {
      question: "جيوارسس مولانا علي ع م انسس مولاتنا فاطمة ع م يه ايك بهوكا مهمان نسس جمن جمارٌو، ته وقت مولانا علي ع م يه ديوا ما روشني نه كيدي، انسس ايم ديكهاوو كيدو كه اْثث جمن تناول كرسس ؛ ، اْثث يه اْ مثل سوطط كام عمل كيدو ؟",
      options: ["تاكه مهمان شرمايا بغير جمن جمي سكسس", "تاكه تهورٌو جمن زياده وقت لكك باقي رهسس", "تاكه ككرمي نه لاككسس", "ديوا نو تيل بححاوانسس"],
      explanation: "",
      hint: "Think about the guest's feelings, not the food.",
    },
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
        "Cut away what is harmful — wastage of food, and whatever compromises the faith",
        "Gauge each person's temperament before dealing with them",
        "Offer warmth or a cold shoulder according to the season",
        "Mend a torn relationship so skilfully the tear cannot be seen",
      ],
      explanation:
        "Cutting away the excess means removing wastage and whatever harms the faith — Syedna Abdeali Saifuddin RA cut off an interest-based loan at once.",
      hint: "What do scissors and a knife both do?",
    },
    ld: {
      question: "جمن تيار كرنار انسس كثثرا بناؤنار ني جه 6 خوبيو ذكر تهئي، اهما سي اْ خوبي - قينححي ححلاوو انسس ححهري ححلاوو - سوطط درس سكهاوسس ؛؟",
      options: ["جه نقصان كرتو هوئي اهنسس كاثثي ناكهوو ، انسس جه دين ما نقصان كرسس اهنسس كاثثي ديوو", "كوئي نا ساتهسس رشته راكهوا ثثهلسس اهنا اخلاق نسس ثثركهوو", "موسم مطابق (ككرمي انسس ضضهندٌي) ، رغبة انسس اعراض كروو", "رشته نسس خوبي سي درست كروو، تاكه جه ثثهاضضي ككيو تهو يه نه ديكهائي"],
      explanation: "",
      hint: "What do scissors and a knife both do?",
    },
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
      hint: "A trust (amanat) is only ever on loan.",
    },
    ld: {
      question: "جيوارسس ابو طلحة نا فرزند ككزري ككيا، تيوارسس اهنا بئيرو يه اهنسس يه وات ني خبر نه كيدي، اهنسس جمن جمارٌو، ته بعد بيسرسس دن اهنسس سؤال كيدو: \" تميطط وه لوككو نو سوطط كهو ححهو ، جه سككلا نسس كوئي ححيز امانة اْثثوا ما اْوي، انسس جيوارسس يه ححيز يه سككلا سي ثثاححهي ليوا ما اْوي تيوارسس يه سككلا رووا لاككي ككيا\" ابو طلحة نا بئيرو سوطط سكهاوسس ؛؟",
      options: ["فرزند خدا تع ني امانة تها، جه نسس خدا تع يه هوسس لئي ليدي ؛- تو اثثنسس روو نه جوئيسس", "بئيرو نسس هر غم ني خبر مرد نسس نه اْثثوي جوئيسس", "صبر يعني حزن نسس نه ظاهر كروو", "امانة جيوارسس ثثاححهي طلب كروا ما اْوسس، تيوارسس} ثثاححهي اداء كري ديوي دوئيسس"],
      explanation: "",
      hint: "A trust (amanat) is only ever on loan.",
    },
  },
  {
    id: "q4",
    majlis: "Majlis 8 · Siyasat / governance",
    majlisLd: "مجلس ٨ · سياست",
    correctIndex: 0,
    en: {
      question:
        "Amirul Mumineen AS got Maulatona Fatema AS the pomegranate she longed for, but gave it away as sadaqa. On his return, what did she do?",
      options: [
        "She embraced him and said her longing had vanished the instant the sadaqa was given",
        "She said the thawab of the sadaqa was sweeter to her than the fruit",
        "She told him she had already forgotten asking for it",
        "They did not talk about it",
      ],
      explanation:
        "Her refined siyaasat of the home (khaassa) spared Amirul Mumineen AS any sense of failure.",
      hint: "She put Ali AS's peace above her own craving.",
    },
    ld: {
      question: "امير المؤمنين ع م يه دارم نو صدقة كري ديدو. جيوارسس اْثث ثثاححها ثثدهارا، تيوارسس مولاتنا فاطمة ع م يه سوطط فرمايو؟",
      options: ["ايم فرمايو كه جيوارسس مولانا علي ع م يه سائل نسس صدقة كيدو ، تيوارسس اْثث نو شوق ختم تهئي ككيو ،", "صدقة نو ثواب يه دارم كرتا بهتر ؛", "اْثث بهولي ككيا تها كه اْثث يه دارم مانككو تهو", "اْ امر ني وات نه كيدي"],
      explanation: "",
      hint: "She put Ali AS's peace above her own craving.",
    },
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
      hint: "Noon = noor = light. What is light famous for?",
    },
    ld: {
      question: "سفينة نا لفظ ما \"ن\" سي كئي خوبي ني ذكر تهئي ؟",
      options: ["تيزي ، شتابي", "user-friendliness", "ثثركهوو", "زندككي نا دراز لكك علم طلب كروو"],
      explanation: "",
      hint: "Noon = noor = light. What is light famous for?",
    },
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
      hint: "Count the boundaries of the building itself, inside and out.",
    },
    ld: {
      question: "مسجد نا سات حدود ني ذكر تهئي ، يه كيا كيا ؛ ؟",
      options: ["زمين، 4 ديوار، ححهت، انسس هواء", "اساس، ححار تهمبا، ككنبد انسس محراب", "محراب، منبر، ححار ديوار انسس ككنبد", "زمين، ساحة، بسس ديوار، ححهت، انسس منارة"],
      explanation: "",
      hint: "Count the boundaries of the building itself, inside and out.",
    },
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
      hint: "What must come before any effort — even Ismail AS's?",
    },
    ld: {
      question: "مولى طع يه هر تدبير(plan) نو اساس سوطط بتايو؟",
      options: ["توكل", "دولة", "طاقة", "علم"],
      explanation: "",
      hint: "What must come before any effort — even Ismail AS's?",
    },
  },
  {
    id: "q8",
    majlis: "Majlis 4 · Lawyers & doctors",
    majlisLd: "مجلس ٤ · ؤکيل انے ڈاکٹر",
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
      hint: "How could a pest actually keep food affordable?",
    },
    ld: {
      question: "امام جعفر الصادق ع م يه فرمايو كه خدا تع يه شر نسس ثثيدا كيدو نتهي- ككيهوطط نا اندر جه كيراؤ ثثري جائي ؛ يه بهي كئي طرح خير ؛ ؟",
      options: ["كيراؤ نا خوف نا سبب سي بادشاهو حكرة نهيطط كري سكتا، جه نا سبب جمن سـستو رهسس ؛", "كيراؤ صبر نو امتحان لسس ؛", "كيرٌاو ثثرنداؤ واسطسس جمن ؛", "موت ني ياد دلاوسس ؛"],
      explanation: "",
      hint: "How could a pest actually keep food affordable?",
    },
  },
  {
    id: "q9",
    majlis: "Majlis 4 · Lawyers & doctors",
    majlisLd: "مجلس ٤ · ؤکيل انے ڈاکٹر",
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
      hint: "The Imam pointed to himself, not to a chain of names.",
    },
    ld: {
      question: "ابو حنيفة نسس شك تهو كه امام ع م نا نزديك جه عصا ؛ يه رسول الله صلع ني ؛ كه نهيطط ، امام ع م يه سوطط جواب اْثثو؟",
      options: ["تنسس اْ وات ما تو شك نتهي نسس كه اْ ككوشت ثثوشت رسول الله نو ؛ !", "اْثث يه رسول الله صلع لكك اسانيد نسس جورٌي", "اْثث يه فرمايو كه ايمان راكهنار نسس دليل ني ضرورة نتهي", "اْثث يه ابو حنيفة نسس فرمايو كه يه حجة كري نسس بتاوسس كه كئي طرح اْثث غلط ؛"],
      explanation: "",
      hint: "The Imam pointed to himself, not to a chain of names.",
    },
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
      hint: "It's not how you say it, but with what intention.",
    },
    ld: {
      question: "كلمة الشهادة ثثرٌهوا سي جان انسس ملكة ني حفاظة تهئي جائي ؛ ، مككر كلمة الشهادة نسس سوطط شاكلة سي ثثرٌهسس تو جنة ما داخل تهئي جائي ؟",
      options: ["اخلاص سي ثثرٌهوا سي", "بلند اْواز سي ثثرٌهوا سي", "عربي ما تلاوة كروا سي", "روز ثثرٌهوا سي"],
      explanation: "",
      hint: "It's not how you say it, but with what intention.",
    },
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
      hint: "They let the shaikh judge 'their' wudhu.",
    },
    ld: {
      question: "امام حسن انسس حسين ع م يه كئي طرح شيخ نسس وضوء سكهاوي",
      options: ["اهنسس judge بنايا تاكه ثثوتاني غلطي نسس ديكهسس", "اهنا ساتهسس وضوء كيدي تاكه يه ديكهي نسس سيكهسس", "سككلا حاضرين نسس وضوء سكهاوي", "رسول الله نسس عرض كيدي كه اْثث سكهاوسس"],
      explanation: "",
      hint: "They let the shaikh judge 'their' wudhu.",
    },
  },
  {
    id: "q12",
    majlis: "Majlis 8 · Siyasat / governance",
    majlisLd: "مجلس ٨ · سياست",
    correctIndex: 0,
    en: {
      question: "In the narration of Malik bin Dinar, an ironsmith could hold scorching iron bare-handed. Why?",
      options: [
        "He had once abstained from a secret sin for Allah's happiness alone",
        "He used a special oil",
        "He had thick skin from his trade",
        "He recited a protective du'a",
      ],
      explanation:
        "Governing the self (siyaasat zaatiyya): honouring his own soul in secret, Allah rewarded him with immunity from fire.",
      hint: "It wasn't physical — think about something he did privately for Allah.",
    },
    ld: {
      question: "مالك بن دينار ني رواية ما ايك لوهار ككرم لوكهندٌ نسس هاته سي ثثكرٌي سكتو تهو، يه كئي طرح امكان تهيو؟",
      options: ["اْ لوهار يه ايك وار خدا ني خوشي واسطسس ككناه سي باز رهيا تها.", "ايك خاص تيل نو استعمال كيدو", "اهني ححامرٌي ككهني جاري تهي", "دعاء ني تلاوة كرسس ؛"],
      explanation: "",
      hint: "It wasn't physical — think about something he did privately for Allah.",
    },
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
      hint: "The birds still fly out each morning — they don't sit idle.",
    },
    ld: {
      question: "جو اككر لوككو خدا ثثر توكل كرسس كه خدا تع يه سككلا نسس ثثرنده ني مثل رزق اْثثسس، ثثرنده فجر ما بهوكو نكلسس؛ انسس سانجسس ثثيت بهريلو هوئي ؛ ، يه سوطط سكهاوسس ؛؟",
      options: ["خدا ثثر توكل كروو ، حلال سي ويثثار كروو، ايم يقين راكهوو كه رزق اْثثنار تو خدا ؛", "ويثثار كروا ني ضرورة نتهي", "محنة بغير رزق ملي جائي ؛", "تمام كمائي لضضاوي دسس"],
      explanation: "",
      hint: "The birds still fly out each morning — they don't sit idle.",
    },
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
      hint: "The guarantor named in the deal always keeps His word.",
    },
    ld: {
      question: "داعي ابي سفيان رض سي وه مرد يه خدا تع نسس كفيل راكهتا هوا اونضض خريدو، انسس رقم نه اداء كيدي ، ته بعد سوطط بنو؟",
      options: ["اونضض ثثاححهو اْثثنا ثثاسسس اْوي ككيو، انسس اهنا اوثثر تمر ؛.", "مرد نسس سزا تهئي", "داعي يه قرض معاف كري ديدو", "اونضض ثثاححهو ملو} نهيطط"],
      explanation: "",
      hint: "The guarantor named in the deal always keeps His word.",
    },
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
      hint: "Count the distinct kinds in the Rasa'il — fewer than ten.",
    },
    ld: {
      question: "سياسة كتنا قسم ني ؛ ؟",
      options: ["ثثانحح", "تين", "نو", "سات"],
      explanation: "",
      hint: "Count the distinct kinds in the Rasa'il — fewer than ten.",
    },
  },
];

export function getQuestion(id: string): QuizQuestion | undefined {
  return QUIZ_QUESTIONS.find((q) => q.id === id);
}
