// Every text a ticket author reads, as neutral built-in defaults. A project overrides any field of
// any key through `config.messages`; a story can override again through `config.messages.story`.

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Which template this issue type should have been written to. */
export function templateFor(issuetype) {
  return /bug/i.test(String(issuetype ?? '')) ? 'bug' : 'story'
}

const featureLabels = config => (config.features || []).map(f => f.label)
const prefixes = config => (config.titlePrefixes || []).map(p => `[${p}]`)

function defaults(config) {
  const labels = featureLabels(config)
  const pre = prefixes(config)
  return {
    ac_present: {
      title: 'Acceptance criteria',
      missing: 'We could not find acceptance criteria.',
      add: [
        'You can copy this and adjust it to your case. Either format works. A short list under an "Acceptance criteria" heading, one result per line:',
        '',
        '## Acceptance criteria',
        '- After saving, the list shows the new item with its name and today\'s date, and the counter above the list goes up by one.',
        '',
        'Or Given / When / Then, each at the start of its line:',
        '',
        'Given an empty list',
        'When I save a new item',
        'Then the list shows one row with that item',
      ].join('\n'),
      question: 'What should be true when this is done? Plain sentences (at least 150 characters), or Given / When / Then.',
      example: 'After saving, the list shows the new item with its name and today\'s date, and the counter above the list goes up by one. Nothing else in the list changes.',
      label: 'acceptance criteria (Given / When / Then, or a list under an Acceptance criteria heading)',
    },
    ac_testable: {
      title: 'Acceptance criteria: results must be specific',
      missing: 'An acceptance criterion does not state a concrete result.',
      add: [
        'Please avoid "it works" or "as expected". A number or the exact text on screen is enough, for example:',
        '',
        '- The list shows exactly 5 rows',
        'Then the message is "No items found"',
      ].join('\n'),
      question: 'An acceptance criterion is vague. Write it again with something a test can see (a label, a row count, a message), at least 150 characters, or as Given / When / Then.',
      example: 'The list shows exactly 5 rows after filtering by code 22, one per matching item, and the counter above the list reads 5 results. Rows for code 220 are not shown.',
      label: 'testable acceptance criteria: each Then or criterion an observable result, not "works correctly"',
    },
    feature_label: {
      title: 'Feature label',
      missing: 'The ticket has no feature label, so we cannot tell which screen to open.',
      add: labels.length
        ? ['Please add one of these existing labels (do not create a new one):', labels.join(', ')].join('\n')
        : 'Please add a feature label that already exists (do not create a new one).',
      question: labels.length ? `Which screen is it? One of: ${labels.join(', ')}` : 'Which screen is it?',
      example: labels[0] ?? '',
      label: 'a feature label from the configured features',
    },
    qa_plan_found: {
      title: 'QA plan',
      missing: 'There is no QA plan for this feature.',
      label: 'a QA plan for the feature',
    },
    steps: {
      title: 'Steps to reproduce',
      missing: 'There is no Steps to reproduce section (or user story).',
      add: [
        'A short numbered list is enough. You can adapt this:',
        '',
        '## Steps to reproduce',
        '1. Open the list',
        '2. Filter by code 22',
        '3. Look at the rows that come back',
      ].join('\n'),
      question: 'How do you reproduce it? One step per line.',
      example: 'Open the list\nFilter by a code that does not exist\nLook at the empty list',
      label: 'steps to reproduce (Bug) or a user story (Story)',
    },
    expected_defined: {
      title: 'Expected and actual result',
      missing: 'Expected and Actual are not both filled in.',
      add: [
        'Please add both sections, for example:',
        '',
        '## Expected',
        'Only code 22 is listed',
        '',
        '## Actual',
        'Code 220 is listed as well',
      ].join('\n'),
      question: 'What should you see, and what do you see now? Write: expected | actual',
      example: 'The message "No items found" is shown | The list is blank',
      label: 'clear expected behaviour (Expected vs Actual, or acceptance criteria present)',
    },
    context: {
      title: 'Summary',
      missing: 'There is no Summary or Context section.',
      add: [
        'A couple of sentences is enough, for example:',
        '',
        '## Summary',
        'When the filter is empty, the list keeps the previous rows instead of clearing.',
      ].join('\n'),
      question: 'In one or two sentences, what is wrong?',
      example: 'When the filter is empty, the list keeps the previous rows instead of clearing.',
      label: 'a Context / Summary section',
    },
    title_prefix: {
      title: 'Title prefix',
      missing: pre.length
        ? `The title does not start with ${pre.join(', ')}.`
        : 'The title does not start with a prefix.',
      add: pre.length ? `Please start the title with one of ${pre.join(', ')}.` : 'Please start the title with a prefix.',
      question: pre.length ? `Which prefix fits? Type one of ${(config.titlePrefixes || []).join(', ')}.` : 'Which prefix fits?',
      example: (config.titlePrefixes || [])[0] ?? '',
      label: 'a title prefix',
    },
    environment: {
      title: 'Environment',
      missing: 'There is no Environment section with Env: …',
      add: [
        'Please add which environment you used (prod, staging or local):',
        '',
        '## Environment',
        'Env: staging',
      ].join('\n'),
      question: 'Which environment did you use (prod, staging or local)?',
      example: 'staging',
      label: 'environment context',
    },
  }
}

/** Story wording for the blocks that are Bug language. */
const STORY = {
  steps: {
    title: 'User story',
    missing: 'There is no User story line.',
    add: [
      'One line is enough. You can adapt this:',
      '',
      '## User story',
      'As a user, I want to filter the list by period so that I can find last month quickly.',
    ].join('\n'),
    question: 'Who wants what, and why? One line.',
    example: 'As a user, I want to filter the list by period so that I find last month quickly.',
  },
  context: {
    title: 'Context',
    missing: 'There is no Context section.',
    add: [
      'Two or three sentences is enough, for example:',
      '',
      '## Context',
      'Finding one item in the list means scrolling the whole page. Filtering by code would save that.',
    ].join('\n'),
    question: 'In two or three sentences, why is this needed?',
    example: 'Finding one item in the list means scrolling the whole page.',
  },
}

/**
 * Per key: {title, missing, add, question, example, label}. Built-in defaults, then
 * config.messages[key] field by field, then (stories only) config.messages.story[key].
 */
export function messagesFor(config, kind = 'bug') {
  const story = kind === 'story'
  const base = defaults(config)
  const cfg = isObj(config.messages) ? config.messages : {}
  const cfgStory = isObj(cfg.story) ? cfg.story : {}
  const out = {}
  for (const key of Object.keys(base)) {
    out[key] = {
      ...base[key],
      ...(story ? STORY[key] : {}),
      ...(isObj(cfg[key]) ? cfg[key] : {}),
      ...(story && isObj(cfgStory[key]) ? cfgStory[key] : {}),
    }
  }
  return out
}

/** The configured label for a rubric key, or undefined so the rubric's own label stays. */
export function labelOverride(config, issuetype, key) {
  const cfg = isObj(config.messages) ? config.messages : {}
  const story = templateFor(issuetype) === 'story'
  const fromStory = story && isObj(cfg.story) && isObj(cfg.story[key]) ? cfg.story[key].label : undefined
  const fromKey = isObj(cfg[key]) ? cfg[key].label : undefined
  return typeof fromStory === 'string' ? fromStory : typeof fromKey === 'string' ? fromKey : undefined
}

/** The body used when no block is shown: config.messages.refuseFallback, else the neutral default. */
export function refuseFallback(config) {
  const custom = isObj(config.messages) ? config.messages.refuseFallback : undefined
  return typeof custom === 'string' ? custom : 'Please add Steps to reproduce, Expected, Actual, and Given / When / Then.'
}
