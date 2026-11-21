import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyFilmContent} from './film_classifier';
import {HIDDEN_GEMS_TAG_NAME} from './domain_expansion';

test('classifyFilmContent separates Films TO WATCH from Content ABOUT films', () => {
  const toWatch = classifyFilmContent({
    title: '12 Hidden Gems and Underrated Indie Films to Watch This Weekend',
    description: 'Overlooked international cinema recommendations streaming now on MUBI.',
    sourceName: 'IndieWire',
    sourceDomain: 'indiewire.com',
    contentType: 'news',
    categoryNames: ['Cinema'],
    tagNames: [HIDDEN_GEMS_TAG_NAME],
  });
  assert.equal(toWatch, 'to_watch');

  const toWatchPt = classifyFilmContent({
    title: '5 séries de suspense psicológico para assistir na Netflix',
    description: 'Joias escondidas e dicas para maratonar no streaming hoje.',
    sourceName: 'Oficina da Net',
    sourceDomain: 'oficinadanet.com.br',
    contentType: 'news',
    categoryNames: ['Cinema'],
    tagNames: [HIDDEN_GEMS_TAG_NAME],
  });
  assert.equal(toWatchPt, 'to_watch');

  const toWatchEs = classifyFilmContent({
    title: 'Netflix: el thriller psicológico tan oscuro que deberías ver cuando no haya menores cerca',
    description: 'En esta serie conocerás a una de las unidades especiales del FBI.',
    sourceName: 'SensaCine México on MSN',
    sourceDomain: 'msn.com',
    contentType: 'news',
    categoryNames: ['Cinema'],
    tagNames: ['Psychological Thriller'],
  });
  assert.equal(toWatchEs, 'to_watch');

  const aboutFilm = classifyFilmContent({
    title: 'Stanley Kubrick Cinematography Analysis: How One-Point Perspective Builds Dread',
    description: 'An essay and director retrospective examining camera movement and lighting.',
    sourceName: 'Sight & Sound',
    sourceDomain: 'bfi.org.uk',
    contentType: 'news',
    categoryNames: ['Cinema'],
    tagNames: ['Stanley Kubrick'],
  });
  assert.equal(aboutFilm, 'about_film');

  const industryNews = classifyFilmContent({
    title: 'Cannes Film Festival Lineup Announced with New Psychological Thriller Competition',
    description: 'Festival coverage and awards outlook.',
    sourceName: 'Variety',
    sourceDomain: 'variety.com',
    contentType: 'news',
    categoryNames: ['Cinema'],
    tagNames: ['Psychological Thriller'],
  });
  assert.equal(industryNews, 'about_film');
});

test('classifyFilmContent returns null for non-entertainment scientific items', () => {
  const chem = classifyFilmContent({
    title: 'Rhodium-Catalyzed Hydroformylation of Internal Alkenes',
    description: 'A mechanistic study of regioselective aldehyde synthesis.',
    sourceName: 'Journal of the American Chemical Society',
    sourceDomain: 'pubs.acs.org',
    contentType: 'article',
    categoryNames: ['Chemistry'],
    tagNames: ['Hydroformylation'],
  });
  assert.equal(chem, null);

  const thinFilm = classifyFilmContent({
    title: 'Skeletal editing by tip-induced chemistry',
    description: 'Tip-induced oxygen deletion on bilayer NaCl films to generate perylene molecules.',
    sourceName: 'arXiv (cond-mat.mes-hall)',
    sourceDomain: 'arxiv.org',
    contentType: 'article',
    categoryNames: ['Chemistry'],
    tagNames: ['Green chemistry'],
  });
  assert.equal(thinFilm, null);
});

test('classifyFilmContent returns null for News / Current Affairs and Astronomy articles mentioning film keywords', () => {
  const newsOscar = classifyFilmContent({
    title: 'Oscar winners speak on Ukraine and NATO diplomacy at European summit',
    description: 'Geopolitical reaction as cultural figures discuss cinema and sanctions.',
    sourceName: 'Reuters',
    sourceDomain: 'reuters.com',
    contentType: 'news',
    categoryNames: ['News / Current Affairs'],
    tagNames: ['Geopolitics', 'Diplomacy'],
  });
  assert.equal(newsOscar, null);

  const astroMovie = classifyFilmContent({
    title: 'NASA releases stunning time-lapse movie of solar flare eruption',
    description: 'New telescope observations reveal magnetic reconnection.',
    sourceName: 'Space.com',
    sourceDomain: 'space.com',
    contentType: 'news',
    categoryNames: ['Astronomy'],
    tagNames: ['Astrophysics'],
  });
  assert.equal(astroMovie, null);
});

