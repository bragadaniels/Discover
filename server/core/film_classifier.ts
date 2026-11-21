import type {ContentType, FilmCategory} from '../../shared/types';
import {HIDDEN_GEMS_TAG_NAME} from './domain_expansion';

export interface FilmClassificationInput {
  title: string;
  description: string | null;
  sourceName: string;
  sourceDomain: string;
  contentType: ContentType;
  categoryNames?: string[];
  tagNames?: string[];
  matchedTerms?: string[];
}

const ENTERTAINMENT_CONTEXT_TERMS = [
  'cinema',
  'film',
  'films',
  'movie',
  'movies',
  'filmes',
  'películas',
  'hidden gems',
  'pouco conhecidos',
  'thriller',
  'kubrick',
  'hitchcock',
  'villeneuve',
  'lynch',
  'scorsese',
  'tarantino',
  'park chan-wook',
  'bong joon-ho',
  'wong kar-wai',
  'tarkovsky',
  'kurosawa',
  'miyazaki',
  'ghibli',
  'a24',
  'criterion',
  'mubi',
  'noir',
  'entertainment',
  'entretenimento',
  'hollywood',
  'arthouse',
  'director',
];

const FILM_SIGNAL_REGEX =
  /\b(movie|movies|cinema|filme|filmes|película|películas|cinéma|kino|screenplay|cinematography|box office|trailer|watchlist|cannes|sundance|oscar|oscars|bafta|letterboxd|mubi|criterion|indie film|arthouse|filmmaker|motion picture)\b/i;

const SCIENTIFIC_NON_CINEMA_REGEX =
  /\b(thin film|thin films|bilayer|monolayer|oxide film|polymer film|nanoparticle|catalysis|spectroscopy|quantum|condensed matter|molecule|molecular|scanning tunneling)\b/i;

// Strong signals for "Content ABOUT films" (analysis, reviews, interviews, production/industry news, awards)
const ABOUT_FILM_REGEX =
  /\b(review|reviews|explained|ending explained|analysis|essay|video essay|interview|behind the scenes|making of|cinematography|screenplay|screenwriter|box office|opening weekend|casting|cast in|joins cast|sequel announced|in development|production|filming wraps|festival coverage|wins palme|oscar nominations|academy awards|golden globes|bafta|tribute|retrospective|ranked|critique|crítica|análise|entrevista|bastidores|bilheteria|estreia nos bastidores|reseña|entrevista|taquilla|critique de film|Filmkritik|Dreharbeiten)\b/i;

// Strong signals for "Films TO WATCH" (recommendations, hidden gems, watchlists, releases to stream/see)
const TO_WATCH_REGEX =
  /\b(hidden gem|hidden gems|films to watch|movies to watch|series to watch|shows to watch|must-watch|must watch|worth watching|underrated films|underrated movies|overlooked films|overlooked classics|movies you missed|films you missed|best movies|best films|where to watch|now streaming|streaming guide|watchlist|curated list|films like|movies similar to|recommended films|film recommendations|movie recommendations|filmes pouco conhecidos|filmes para assistir|séries para assistir|para assistir na|para assistir no|para assistir hoje|em alta na netflix|para maratonar|vale a pena assistir|filmes imperdíveis|dicas de filmes|dicas de séries|joias escondidas|melhores filmes|onde assistir|películas recomendadas|películas poco conocidas|películas para ver|deberías ver|tienes que ver|para ver en|imperdibles|films à voir|films méconnus|à voir sur|Geheimtipp|Geheimtipps|sehenswert|must-see)\b/i;

export function isEntertainmentCategoryName(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return /\b(cinema|film|films|movie|movies|filmes|pel[ií]culas|entertainment|entretenimento|series|television|tv|anime)\b/i.test(
    lower
  );
}

export function isEntertainmentContext(input: FilmClassificationInput): boolean {
  const catNames = (input.categoryNames || []).filter(Boolean);
  const tagTerms = [...(input.tagNames || []), ...(input.matchedTerms || [])]
    .join(' ')
    .toLowerCase();

  const hasEntertainmentCategory = catNames.some((c) => isEntertainmentCategoryName(c));
  const hasEntertainmentTag = ENTERTAINMENT_CONTEXT_TERMS.some((t) => tagTerms.includes(t));

  // If explicit non-entertainment categories are provided (e.g. News / Current Affairs, Astronomy, Chemistry)
  // and none of the matched tags are entertainment-specific, never label general articles as cinema sub-tabs.
  if (catNames.length > 0 && !hasEntertainmentCategory && !hasEntertainmentTag) {
    return false;
  }

  // Never misclassify arXiv/Crossref scientific papers (e.g. "bilayer NaCl films") as cinema
  if (
    input.sourceDomain === 'arxiv.org' ||
    input.sourceName.toLowerCase().startsWith('arxiv') ||
    input.contentType === 'article'
  ) {
    const text = `${input.title} ${input.description || ''}`;
    if (SCIENTIFIC_NON_CINEMA_REGEX.test(text)) {
      return false;
    }
  }

  if (hasEntertainmentCategory || hasEntertainmentTag) {
    return true;
  }

  const text = `${input.title} ${input.description || ''} ${input.sourceName}`;
  if (SCIENTIFIC_NON_CINEMA_REGEX.test(text)) {
    return false;
  }
  return FILM_SIGNAL_REGEX.test(text);
}

export function classifyFilmContent(input: FilmClassificationInput): FilmCategory {
  if (!isEntertainmentContext(input)) {
    return null;
  }

  const text = `${input.title} ${input.description || ''}`;
  const isHiddenGemsTag = (input.tagNames || []).some(
    (t) =>
      t.toLowerCase() === HIDDEN_GEMS_TAG_NAME.toLowerCase() ||
      t.toLowerCase().includes('hidden gem') ||
      t.toLowerCase().includes('pouco conhecidos')
  );

  const hasToWatchSignal = TO_WATCH_REGEX.test(text);
  const hasAboutSignal = ABOUT_FILM_REGEX.test(text);

  if (hasToWatchSignal && !hasAboutSignal) {
    return 'to_watch';
  }

  if (hasAboutSignal && !hasToWatchSignal) {
    return 'about_film';
  }

  if (hasToWatchSignal && hasAboutSignal) {
    // Example: "10 Underrated Indie Films to Watch (Review)" vs "Film Review: ..."
    // If title leads with recommendation / list / streaming / hidden gems, favor to_watch
    if (TO_WATCH_REGEX.test(input.title)) {
      return 'to_watch';
    }
    return 'about_film';
  }

  // If discovered specifically through Hidden Gems and not flagged as industry/review/analysis
  if (isHiddenGemsTag) {
    return 'to_watch';
  }

  // Default for cinema news/articles/video essays when no explicit watch/recommendation cue is present
  return 'about_film';
}
