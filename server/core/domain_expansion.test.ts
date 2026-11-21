import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectTopicDomain,
  HIDDEN_GEMS_TAG_NAME,
  previewTagSuggestions,
  translateTagForLanguage,
} from './domain_expansion';

test('detectTopicDomain classifies entertainment, science, technology, and geopolitics accurately', () => {
  assert.equal(detectTopicDomain('Psychological Thriller', 'Cinema'), 'entertainment');
  assert.equal(detectTopicDomain('Stanley Kubrick'), 'entertainment');
  assert.equal(detectTopicDomain(HIDDEN_GEMS_TAG_NAME), 'entertainment');
  assert.equal(detectTopicDomain('Hydroformylation', 'Chemistry'), 'science');
  assert.equal(detectTopicDomain('Cybersecurity', 'Technology'), 'technology');
  assert.equal(detectTopicDomain('Foreign Policy', 'Geopolitics'), 'geopolitics');
});

test('previewTagSuggestions gives cinema-native suggestions for Psychological Thriller and Stanley Kubrick', () => {
  const thriller = previewTagSuggestions('Psychological Thriller', {categoryName: 'Cinema'});
  assert.equal(thriller.domain, 'entertainment');
  assert.ok(thriller.suggestions.some((s) => s.term.includes('David Fincher')));
  assert.ok(thriller.suggestions.some((s) => s.term.includes('unreliable narrator')));
  assert.equal(
    thriller.suggestions.some((s) => s.term.includes('advances') || s.term.includes('research')),
    false
  );

  const kubrick = previewTagSuggestions('Stanley Kubrick', {categoryName: 'Cinema'});
  assert.equal(kubrick.domain, 'entertainment');
  assert.ok(kubrick.suggestions.some((s) => s.term.includes('2001 A Space Odyssey')));
  assert.ok(kubrick.suggestions.some((s) => s.term.includes('one-point perspective')));
});

test('previewTagSuggestions preserves scientific suggestions for Hydroformylation', () => {
  const chem = previewTagSuggestions('Hydroformylation', {categoryName: 'Chemistry'});
  assert.equal(chem.domain, 'science');
  assert.ok(chem.suggestions.some((s) => s.term === 'oxo process'));
});

test('previewTagSuggestions configures Hidden Gems / Filmes pouco conhecidos with indie terms and blockbuster exclusions', () => {
  const gems = previewTagSuggestions(HIDDEN_GEMS_TAG_NAME, {
    categoryName: 'Cinema',
    languages: ['en', 'pt', 'es'],
  });
  assert.equal(gems.domain, 'entertainment');
  assert.ok(gems.suggestions.some((s) => s.term.toLowerCase().includes('independent')));
  assert.ok(gems.exclusions.includes('mcu'));
  assert.ok(gems.multilingualTerms.some((m) => m.language === 'pt'));
  assert.ok(gems.multilingualTerms.some((m) => m.language === 'es'));
});

test('translateTagForLanguage translates Artificial Intelligence across EN/PT/ES/FR/DE', () => {
  assert.equal(translateTagForLanguage('Artificial Intelligence', 'pt', 'technology'), 'Inteligência Artificial');
  assert.equal(translateTagForLanguage('Artificial Intelligence', 'es', 'technology'), 'Inteligencia Artificial');
  assert.equal(translateTagForLanguage('Artificial Intelligence', 'fr', 'technology'), 'Intelligence Artificielle');
  assert.equal(translateTagForLanguage('Artificial Intelligence', 'de', 'technology'), 'Künstliche Intelligenz');
});
