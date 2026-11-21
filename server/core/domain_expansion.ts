import type {SuggestedTermItem, TagSuggestionPreview, TopicDomain} from '../../shared/types';

interface StructuredExpansionEntry {
  domain: TopicDomain;
  suggestions: SuggestedTermItem[];
  exclusions?: string[];
}

export const HIDDEN_GEMS_TAG_NAME = 'Hidden Gems / Filmes pouco conhecidos';

const DOMAIN_ENTRIES: Record<string, StructuredExpansionEntry> = {
  // === SCIENCE & CHEMISTRY & ASTRONOMY (Preserved & enriched) ===
  hydroformylation: {
    domain: 'science',
    suggestions: [
      {term: 'oxo process', facet: 'Process Name'},
      {term: 'rhodium-catalyzed hydroformylation', facet: 'Catalyst System'},
      {term: 'aldehyde synthesis', facet: 'Reaction Outcome'},
      {term: 'homogeneous catalysis', facet: 'Subfield'},
    ],
  },
  catalysis: {
    domain: 'science',
    suggestions: [
      {term: 'heterogeneous catalysis', facet: 'Subfield'},
      {term: 'homogeneous catalysis', facet: 'Subfield'},
      {term: 'photocatalysis', facet: 'Mechanism'},
      {term: 'reaction kinetics', facet: 'Measurement'},
    ],
  },
  'green chemistry': {
    domain: 'science',
    suggestions: [
      {term: 'sustainable chemistry', facet: 'Field'},
      {term: 'atom economy', facet: 'Principle'},
      {term: 'biodegradable solvents', facet: 'Materials'},
      {term: 'catalytic green synthesis', facet: 'Methodology'},
    ],
  },
  'olefin metathesis': {
    domain: 'science',
    suggestions: [
      {term: 'ring-closing metathesis', facet: 'Reaction Type'},
      {term: 'ruthenium carbene catalyst', facet: 'Catalyst'},
      {term: 'cross metathesis', facet: 'Reaction Type'},
    ],
  },
  'deep eutectic solvents': {
    domain: 'science',
    suggestions: [
      {term: 'natural deep eutectic solvents', facet: 'Variant'},
      {term: 'ionic liquid alternatives', facet: 'Related Media'},
      {term: 'green extraction solvent', facet: 'Application'},
    ],
  },
  'organometallic chemistry': {
    domain: 'science',
    suggestions: [
      {term: 'transition metal complexes', facet: 'Structures'},
      {term: 'ligand design', facet: 'Methodology'},
      {term: 'c-h activation', facet: 'Reaction Class'},
    ],
  },
  exoplanets: {
    domain: 'science',
    suggestions: [
      {term: 'transiting exoplanets', facet: 'Detection'},
      {term: 'exoplanet atmosphere', facet: 'Characterization'},
      {term: 'jwst exoplanet spectroscopy', facet: 'Instrumentation'},
    ],
  },
  astrophysics: {
    domain: 'science',
    suggestions: [
      {term: 'compact objects', facet: 'Phenomena'},
      {term: 'gravitational waves', facet: 'Observation'},
      {term: 'stellar evolution', facet: 'Subfield'},
    ],
  },
  'space exploration': {
    domain: 'science',
    suggestions: [
      {term: 'deep space mission', facet: 'Mission Class'},
      {term: 'lunar exploration', facet: 'Destination'},
      {term: 'planetary science mission', facet: 'Research'},
    ],
  },
  cosmology: {
    domain: 'science',
    suggestions: [
      {term: 'dark energy survey', facet: 'Observatory'},
      {term: 'cosmic microwave background', facet: 'Observable'},
      {term: 'hubble tension', facet: 'Open Problem'},
    ],
  },

  // === TECHNOLOGY ===
  'artificial intelligence': {
    domain: 'technology',
    suggestions: [
      {term: 'machine learning', facet: 'Core Field'},
      {term: 'large language models', facet: 'Architecture'},
      {term: 'neural networks', facet: 'Methodology'},
      {term: 'foundation models', facet: 'Systems'},
    ],
  },
  python: {
    domain: 'technology',
    suggestions: [
      {term: 'python programming', facet: 'Language'},
      {term: 'python ecosystem', facet: 'Libraries'},
      {term: 'python performance', facet: 'Engineering'},
    ],
  },
  cybersecurity: {
    domain: 'technology',
    suggestions: [
      {term: 'vulnerability research', facet: 'Research'},
      {term: 'zero-day security', facet: 'Threats'},
      {term: 'cryptography security', facet: 'Defense'},
    ],
  },
  'open-source software': {
    domain: 'technology',
    suggestions: [
      {term: 'open source maintainer', facet: 'Community'},
      {term: 'foss governance', facet: 'Governance'},
      {term: 'open source release', facet: 'Releases'},
    ],
  },
  'computer hardware': {
    domain: 'technology',
    suggestions: [
      {term: 'semiconductor architecture', facet: 'Silicon'},
      {term: 'risc-v processor', facet: 'ISA'},
      {term: 'gpu architecture', facet: 'Compute'},
    ],
  },

  // === GEOPOLITICS ===
  geopolitics: {
    domain: 'geopolitics',
    suggestions: [
      {term: 'foreign policy analysis', facet: 'Policy'},
      {term: 'diplomatic relations', facet: 'Diplomacy'},
      {term: 'geoeconomics trade', facet: 'Economics'},
      {term: 'international security', facet: 'Security'},
    ],
  },

  // === ENTERTAINMENT & CINEMA ===
  'hidden gems / filmes pouco conhecidos': {
    domain: 'entertainment',
    suggestions: [
      {term: 'underrated independent films', facet: 'Indie Cinema'},
      {term: 'overlooked world cinema', facet: 'International Film'},
      {term: 'hidden gem movies to watch', facet: 'Recommendations'},
      {term: 'filmes pouco conhecidos recomendados', facet: 'Portuguese Discovery'},
      {term: 'micro-budget arthouse film', facet: 'Low-Budget'},
      {term: 'criterion mubi festival discovery', facet: 'Curated & Festivals'},
      {term: 'neglected cinema classics', facet: 'Overlooked Classics'},
    ],
    exclusions: ['box office record', 'mcu', 'marvel', 'celebrity gossip', 'kardashian'],
  },
  'hidden gems': {
    domain: 'entertainment',
    suggestions: [
      {term: 'underrated independent films', facet: 'Indie Cinema'},
      {term: 'overlooked world cinema', facet: 'International Film'},
      {term: 'hidden gem movies to watch', facet: 'Recommendations'},
      {term: 'filmes pouco conhecidos', facet: 'International Term'},
      {term: 'festival sleeper hits', facet: 'Festivals'},
      {term: 'overlooked classic films', facet: 'Classics'},
    ],
    exclusions: ['box office record', 'celebrity gossip'],
  },
  'psychological thriller': {
    domain: 'entertainment',
    suggestions: [
      {term: 'David Fincher', facet: 'Director'},
      {term: 'Alfred Hitchcock', facet: 'Director & Influence'},
      {term: 'Denis Villeneuve', facet: 'Director'},
      {term: 'Park Chan-wook', facet: 'Director'},
      {term: 'neo-noir suspense', facet: 'Subgenre'},
      {term: 'unreliable narrator film', facet: 'Storytelling Technique'},
      {term: 'Black Swan', facet: 'Comparable Film'},
      {term: 'Shutter Island', facet: 'Comparable Film'},
      {term: 'A24 psychological thriller', facet: 'Studio & Style'},
    ],
  },
  'stanley kubrick': {
    domain: 'entertainment',
    suggestions: [
      {term: '2001 A Space Odyssey', facet: 'Filmography'},
      {term: 'The Shining', facet: 'Filmography'},
      {term: 'Barry Lyndon', facet: 'Filmography'},
      {term: 'A Clockwork Orange', facet: 'Filmography'},
      {term: 'Eyes Wide Shut', facet: 'Filmography'},
      {term: 'one-point perspective cinematography', facet: 'Cinematic Technique'},
      {term: 'John Alcott cinematography', facet: 'Collaborator & Craft'},
    ],
  },
  'david lynch': {
    domain: 'entertainment',
    suggestions: [
      {term: 'Mulholland Drive', facet: 'Filmography'},
      {term: 'Blue Velvet', facet: 'Filmography'},
      {term: 'Twin Peaks', facet: 'Television Series'},
      {term: 'Eraserhead', facet: 'Filmography'},
      {term: 'surrealist cinema', facet: 'Movement & Style'},
      {term: 'Angelo Badalamenti', facet: 'Collaborator'},
      {term: 'neo-noir mystery', facet: 'Subgenre'},
    ],
  },
  'alfred hitchcock': {
    domain: 'entertainment',
    suggestions: [
      {term: 'Vertigo', facet: 'Filmography'},
      {term: 'Rear Window', facet: 'Filmography'},
      {term: 'Hitchcockian suspense', facet: 'Storytelling Technique'},
      {term: 'Bernard Herrmann score', facet: 'Collaborator'},
      {term: 'Brian De Palma', facet: 'Influenced Director'},
    ],
  },
  'denis villeneuve': {
    domain: 'entertainment',
    suggestions: [
      {term: 'Arrival', facet: 'Filmography'},
      {term: 'Sicario', facet: 'Filmography'},
      {term: 'Incendies', facet: 'Filmography'},
      {term: 'Blade Runner 2049', facet: 'Filmography'},
      {term: 'Roger Deakins cinematography', facet: 'Collaborator & Craft'},
    ],
  },
  'park chan-wook': {
    domain: 'entertainment',
    suggestions: [
      {term: 'Oldboy', facet: 'Filmography'},
      {term: 'The Handmaiden', facet: 'Filmography'},
      {term: 'Decision to Leave', facet: 'Filmography'},
      {term: 'Korean New Wave cinema', facet: 'Film Movement'},
      {term: 'Bong Joon-ho', facet: 'Related Filmmaker'},
    ],
  },
  'bong joon-ho': {
    domain: 'entertainment',
    suggestions: [
      {term: 'Parasite', facet: 'Filmography'},
      {term: 'Memories of Murder', facet: 'Filmography'},
      {term: 'Korean cinema', facet: 'Film Movement'},
      {term: 'Cannes Palme d Or', facet: 'Awards & Festivals'},
      {term: 'Park Chan-wook', facet: 'Related Filmmaker'},
    ],
  },
  'wong kar-wai': {
    domain: 'entertainment',
    suggestions: [
      {term: 'In the Mood for Love', facet: 'Filmography'},
      {term: 'Chungking Express', facet: 'Filmography'},
      {term: 'Christopher Doyle cinematography', facet: 'Collaborator'},
      {term: 'Hong Kong New Wave', facet: 'Film Movement'},
    ],
  },
  'andrei tarkovsky': {
    domain: 'entertainment',
    suggestions: [
      {term: 'Stalker', facet: 'Filmography'},
      {term: 'Solaris', facet: 'Filmography'},
      {term: 'slow cinema', facet: 'Movement & Style'},
      {term: 'Ingmar Bergman', facet: 'Influences & Kin'},
    ],
  },
  'akira kurosawa': {
    domain: 'entertainment',
    suggestions: [
      {term: 'Seven Samurai', facet: 'Filmography'},
      {term: 'Rashomon', facet: 'Filmography'},
      {term: 'High and Low', facet: 'Filmography'},
      {term: 'Toshiro Mifune', facet: 'Collaborator'},
    ],
  },
  'studio ghibli': {
    domain: 'entertainment',
    suggestions: [
      {term: 'Hayao Miyazaki', facet: 'Director'},
      {term: 'Isao Takahata', facet: 'Director'},
      {term: 'Spirited Away', facet: 'Filmography'},
      {term: 'Princess Mononoke', facet: 'Filmography'},
      {term: 'Joe Hisaishi', facet: 'Collaborator'},
    ],
  },
  a24: {
    domain: 'entertainment',
    suggestions: [
      {term: 'independent arthouse cinema', facet: 'Studio Identity'},
      {term: 'Robert Eggers', facet: 'Director'},
      {term: 'Celine Song', facet: 'Director'},
      {term: 'Past Lives', facet: 'Filmography'},
      {term: 'Sundance indie film', facet: 'Festivals & Distribution'},
    ],
  },
  'french new wave': {
    domain: 'entertainment',
    suggestions: [
      {term: 'Jean-Luc Godard', facet: 'Director'},
      {term: 'Francois Truffaut', facet: 'Director'},
      {term: 'Agnes Varda', facet: 'Director'},
      {term: 'Nouvelle Vague cinema', facet: 'Movement'},
      {term: 'Cahiers du Cinema', facet: 'Film History'},
    ],
  },
  'film noir': {
    domain: 'entertainment',
    suggestions: [
      {term: 'Billy Wilder', facet: 'Director'},
      {term: 'Double Indemnity', facet: 'Classic Film'},
      {term: 'Sunset Boulevard', facet: 'Classic Film'},
      {term: 'chiaroscuro cinematography', facet: 'Cinematic Technique'},
      {term: 'neo-noir crime', facet: 'Subgenre Evolution'},
    ],
  },
  'science fiction cinema': {
    domain: 'entertainment',
    suggestions: [
      {term: 'cyberpunk film', facet: 'Subgenre'},
      {term: 'Denis Villeneuve', facet: 'Director'},
      {term: 'Blade Runner', facet: 'Comparable Film'},
      {term: 'Ex Machina', facet: 'Comparable Film'},
    ],
  },
  documentary: {
    domain: 'entertainment',
    suggestions: [
      {term: 'cinema verite', facet: 'Movement & Style'},
      {term: 'Werner Herzog', facet: 'Director'},
      {term: 'Agnes Varda', facet: 'Director'},
      {term: 'IDFA documentary', facet: 'Festivals'},
      {term: 'essay film', facet: 'Storytelling Format'},
    ],
  },
  'world cinema': {
    domain: 'entertainment',
    suggestions: [
      {term: 'international arthouse cinema', facet: 'Scope'},
      {term: 'Iranian New Wave', facet: 'Movement'},
      {term: 'Cannes Film Festival', facet: 'Festivals'},
      {term: 'Criterion Collection', facet: 'Curated Distributor'},
      {term: 'MUBI cinema', facet: 'Curated Streaming'},
    ],
  },
  'cinema brasileiro': {
    domain: 'entertainment',
    suggestions: [
      {term: 'Kleber Mendonça Filho', facet: 'Director'},
      {term: 'Walter Salles', facet: 'Director'},
      {term: 'Cinema Novo', facet: 'Movement & History'},
      {term: 'Bacurau', facet: 'Landmark Film'},
      {term: 'Festival de Gramado', facet: 'Festivals'},
    ],
  },
};

// Multilingual deterministic term equivalents for key topics across supported languages
const MULTILINGUAL_EQUIVALENTS: Record<string, Record<string, string>> = {
  'artificial intelligence': {
    en: 'Artificial Intelligence',
    pt: 'Inteligência Artificial',
    es: 'Inteligencia Artificial',
    fr: 'Intelligence Artificielle',
    de: 'Künstliche Intelligenz',
    it: 'Intelligenza Artificiale',
    ja: '人工知能',
    ko: '인공지능',
  },
  'machine learning': {
    en: 'Machine Learning',
    pt: 'Aprendizado de Máquina',
    es: 'Aprendizaje Automático',
    fr: 'Apprentissage Automatique',
    de: 'Maschinelles Lernen',
    it: 'Apprendimento Automatico',
  },
  cybersecurity: {
    en: 'Cybersecurity',
    pt: 'Cibersegurança',
    es: 'Ciberseguridad',
    fr: 'Cybersécurité',
    de: 'Cybersicherheit',
    it: 'Sicurezza Informatica',
  },
  'open-source software': {
    en: 'Open-Source Software',
    pt: 'Software de Código Aberto',
    es: 'Software de Código Abierto',
    fr: 'Logiciel Libre Open Source',
    de: 'Open-Source-Software',
  },
  'space exploration': {
    en: 'Space Exploration',
    pt: 'Exploração Espacial',
    es: 'Exploración Espacial',
    fr: 'Exploration Spatiale',
    de: 'Raumfahrt Weltraumforschung',
    it: 'Esplorazione Spaziale',
  },
  astrophysics: {
    en: 'Astrophysics',
    pt: 'Astrofísica',
    es: 'Astrofísica',
    fr: 'Astrophysique',
    de: 'Astrophysik',
    it: 'Astrofisica',
  },
  exoplanets: {
    en: 'Exoplanets',
    pt: 'Exoplanetas',
    es: 'Exoplanetas',
    fr: 'Exoplanètes',
    de: 'Exoplaneten',
    it: 'Esopianeti',
  },
  cosmology: {
    en: 'Cosmology',
    pt: 'Cosmologia',
    es: 'Cosmología',
    fr: 'Cosmologie',
    de: 'Kosmologie',
  },
  catalysis: {
    en: 'Catalysis',
    pt: 'Catálise',
    es: 'Catálisis',
    fr: 'Catalyse',
    de: 'Katalyse',
  },
  'green chemistry': {
    en: 'Green Chemistry',
    pt: 'Química Verde',
    es: 'Química Verde',
    fr: 'Chimie Verte',
    de: 'Grüne Chemie',
  },
  'psychological thriller': {
    en: 'Psychological Thriller',
    pt: 'Suspense Psicológico',
    es: 'Thriller Psicológico',
    fr: 'Thriller Psychologique',
    de: 'Psychothriller',
    it: 'Thriller Psicologico',
  },
  'hidden gems / filmes pouco conhecidos': {
    en: 'Hidden Gem Independent Films',
    pt: 'Filmes pouco conhecidos',
    es: 'Películas poco conocidas cine independiente',
    fr: 'Films méconnus cinéma indépendant',
    de: 'Unbekannte Filmperlen Geheimtipp Kino',
    it: 'Film poco conosciuti cinema indipendente',
    ja: '隠れた名作映画 インディーズ映画',
    ko: '숨은 명작 독립영화',
  },
  'hidden gems': {
    en: 'Hidden Gem Movies',
    pt: 'Filmes pouco conhecidos',
    es: 'Películas poco conocidas',
    fr: 'Films méconnus pépites cinéma',
    de: 'Film Geheimtipps',
  },
  'independent cinema': {
    en: 'Independent Cinema',
    pt: 'Cinema Independente',
    es: 'Cine Independiente',
    fr: 'Cinéma Indépendant',
    de: 'Independent-Kino',
    it: 'Cinema Indipendente',
  },
  'world cinema': {
    en: 'World Cinema',
    pt: 'Cinema Mundial',
    es: 'Cine Internacional',
    fr: 'Cinéma du Monde',
    de: 'Weltkino Arthouse',
  },
  'film noir': {
    en: 'Film Noir',
    pt: 'Cinema Noir',
    es: 'Cine Negro',
    fr: 'Film Noir',
    de: 'Film Noir',
  },
  documentary: {
    en: 'Documentary Film',
    pt: 'Documentário Cinema',
    es: 'Cine Documental',
    fr: 'Film Documentaire',
    de: 'Dokumentarfilm',
  },
  animation: {
    en: 'Animation Cinema',
    pt: 'Cinema de Animação',
    es: 'Cine de Animación',
    fr: 'Cinéma d’Animation',
    de: 'Animationsfilm',
  },
  'science fiction cinema': {
    en: 'Science Fiction Cinema',
    pt: 'Cinema de Ficção Científica',
    es: 'Cine de Ciencia Ficción',
    fr: 'Cinéma de Science-Fiction',
    de: 'Science-Fiction-Film',
  },
  geopolitics: {
    en: 'Geopolitics',
    pt: 'Geopolítica',
    es: 'Geopolítica',
    fr: 'Géopolitique',
    de: 'Geopolitik',
    it: 'Geopolitica',
  },
};

const ENTERTAINMENT_KEYWORDS = [
  'cinema',
  'film',
  'films',
  'movie',
  'movies',
  'filmes',
  'películas',
  'entertainment',
  'entretenimento',
  'thriller',
  'horror',
  'noir',
  'comedy',
  'drama',
  'animation',
  'anime',
  'documentary',
  'documentário',
  'kubrick',
  'hitchcock',
  'scorsese',
  'tarantino',
  'nolan',
  'villeneuve',
  'lynch',
  'kurosawa',
  'tarkovsky',
  'miyazaki',
  'ghibli',
  'a24',
  'criterion',
  'mubi',
  'cannes',
  'sundance',
  'oscar',
  'cinematography',
  'screenplay',
  'director',
  'actors',
  'series',
  'television',
  'tv show',
  'hidden gems',
  'pouco conhecidos',
  'indie',
  'arthouse',
];

const SCIENCE_KEYWORDS = [
  'chemistry',
  'chemical',
  'catalysis',
  'molecule',
  'synthesis',
  'physics',
  'quantum',
  'astronomy',
  'astrophysics',
  'exoplanet',
  'cosmology',
  'biology',
  'genomics',
  'neuroscience',
  'medicine',
  'materials science',
  'climate',
  'ecology',
  'optics',
  'spectroscopy',
  'mathematics',
];

const TECH_KEYWORDS = [
  'artificial intelligence',
  'machine learning',
  'deep learning',
  'software',
  'programming',
  'python',
  'rust',
  'typescript',
  'cybersecurity',
  'cryptography',
  'hardware',
  'semiconductor',
  'processor',
  'gpu',
  'open-source',
  'linux',
  'robotics',
  'technology',
  'computing',
];

const GEOPOLITICS_KEYWORDS = [
  'geopolitics',
  'politics',
  'current affairs',
  'government',
  'foreign policy',
  'diplomacy',
  'sanctions',
  'nato',
  'trade war',
  'elections',
  'middle east',
  'european union',
  'international relations',
  'macroeconomics',
  'military',
  'armed conflict',
];

export function detectTopicDomain(tagName: string, categoryName = ''): TopicDomain {
  const combined = `${categoryName} ${tagName}`.toLowerCase();

  if (ENTERTAINMENT_KEYWORDS.some((k) => combined.includes(k))) {
    return 'entertainment';
  }
  if (SCIENCE_KEYWORDS.some((k) => combined.includes(k))) {
    return 'science';
  }
  if (TECH_KEYWORDS.some((k) => combined.includes(k))) {
    return 'technology';
  }
  if (GEOPOLITICS_KEYWORDS.some((k) => combined.includes(k))) {
    return 'geopolitics';
  }

  return 'general';
}

function buildFallbackSuggestions(tagName: string, domain: TopicDomain): SuggestedTermItem[] {
  const clean = tagName.trim();
  const lower = clean.toLowerCase();

  if (domain === 'entertainment') {
    if (lower.includes('series') || lower.includes('tv') || lower.includes('show')) {
      return [
        {term: `${clean} television series`, facet: 'Format'},
        {term: `${clean} showrunner writing`, facet: 'Creators & Craft'},
        {term: `${clean} cinematography analysis`, facet: 'Criticism'},
        {term: `${clean} similar series recommendations`, facet: 'Recommendations'},
      ];
    }
    if (lower.includes('anime') || lower.includes('animation')) {
      return [
        {term: `${clean} animation studio`, facet: 'Studio'},
        {term: `${clean} director key animation`, facet: 'Creators & Craft'},
        {term: `${clean} underrated animated films`, facet: 'Recommendations'},
        {term: `${clean} visual storytelling`, facet: 'Themes & Style'},
      ];
    }
    // Likely filmmaker, actor, film title, subgenre, or movement
    return [
      {term: `${clean} filmography`, facet: 'Filmography'},
      {term: `${clean} cinematography direction`, facet: 'Filmmaking Craft'},
      {term: `${clean} underrated films`, facet: 'Recommendations'},
      {term: `${clean} film festival movement`, facet: 'Festivals & History'},
      {term: `${clean} similar movies`, facet: 'Related Films'},
    ];
  }

  if (domain === 'geopolitics') {
    return [
      {term: `${clean} foreign policy`, facet: 'Policy'},
      {term: `${clean} diplomatic developments`, facet: 'Diplomacy'},
      {term: `${clean} trade security`, facet: 'Strategic Context'},
    ];
  }

  if (domain === 'technology') {
    return [
      {term: `${clean} architecture`, facet: 'Engineering'},
      {term: `${clean} open source benchmarks`, facet: 'Ecosystem'},
      {term: `${clean} security implications`, facet: 'Operations'},
    ];
  }

  if (domain === 'science') {
    const words = lower.split(/\s+/).filter(Boolean);
    return words.length === 1
      ? [
          {term: `${clean} research`, facet: 'Literature'},
          {term: `${clean} experimental study`, facet: 'Methodology'},
          {term: `${clean} review article`, facet: 'Synthesis'},
        ]
      : [
          {term: `${clean} advances`, facet: 'Literature'},
          {term: `${clean} mechanism`, facet: 'Methodology'},
        ];
  }

  // General fallback (balanced editorial without fake academic bias)
  return [
    {term: `${clean} overview`, facet: 'Context'},
    {term: `${clean} recent developments`, facet: 'News'},
  ];
}

export function translateTagForLanguage(
  tagName: string,
  language: string,
  domain: TopicDomain
): string | null {
  const lang = language.trim().toLowerCase();
  const normalized = tagName.trim().toLowerCase();
  if (!normalized) return null;

  const exact = MULTILINGUAL_EQUIVALENTS[normalized];
  if (exact && exact[lang]) {
    return exact[lang];
  }

  // Partial key translation when tag matches a known concept directly
  for (const [key, map] of Object.entries(MULTILINGUAL_EQUIVALENTS)) {
    if (normalized === key && map[lang]) {
      return map[lang];
    }
  }

  // For entertainment proper names (directors, studios, film titles), add localized film cue when non-English
  if (domain === 'entertainment' && lang !== 'en') {
    const clean = tagName.trim();
    const quoted = clean.includes(' ') ? `"${clean}"` : clean;
    if (lang === 'pt') return `${quoted} (filme OR cinema)`;
    if (lang === 'es') return `${quoted} (cine OR película)`;
    if (lang === 'fr') return `${quoted} (cinéma OR film)`;
    if (lang === 'de') return `${quoted} (Film OR Kino)`;
    if (lang === 'it') return `${quoted} (cinema OR film)`;
  }

  return null;
}

export function previewTagSuggestions(
  tagName: string,
  options?: {categoryName?: string; languages?: string[]}
): TagSuggestionPreview {
  const clean = tagName.trim();
  if (!clean) {
    return {
      domain: 'general',
      suggestions: [],
      exclusions: [],
      multilingualTerms: [],
    };
  }

  const normalized = clean.toLowerCase();
  const entry = DOMAIN_ENTRIES[normalized];
  let domain: TopicDomain = entry?.domain || detectTopicDomain(clean, options?.categoryName || '');
  let suggestions: SuggestedTermItem[] = entry ? [...entry.suggestions] : [];
  let exclusions: string[] = entry?.exclusions ? [...entry.exclusions] : [];

  if (suggestions.length === 0) {
    // Check partial key match inside same domain
    for (const [key, candidate] of Object.entries(DOMAIN_ENTRIES)) {
      if (normalized.includes(key) || key.includes(normalized)) {
        if (domain === 'general' || candidate.domain === domain) {
          domain = candidate.domain;
          suggestions = candidate.suggestions.slice(0, 4);
          if (candidate.exclusions) {
            exclusions = [...candidate.exclusions];
          }
          break;
        }
      }
    }
  }

  if (suggestions.length === 0) {
    suggestions = buildFallbackSuggestions(clean, domain);
  }

  // Preserve original tag and build deterministic multilingual equivalents for selected languages
  const targetLangs = options?.languages && options.languages.length > 0 ? options.languages : ['en'];
  const multilingualTerms: Array<{language: string; term: string}> = [];
  for (const lang of targetLangs) {
    const translated = translateTagForLanguage(clean, lang, domain);
    if (translated && translated.toLowerCase() !== normalized) {
      multilingualTerms.push({language: lang, term: translated});
    }
  }

  return {
    domain,
    suggestions,
    exclusions,
    multilingualTerms,
  };
}
