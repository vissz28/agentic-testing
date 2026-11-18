"""`Quality Code direct`: one entry for the whole plugin. A message that starts with "Quality Code", "Quality Code direct" or "Using Quality Code" names a command
(or just a Jira key), and the rest is that command's arguments; the command's own instructions, parameters and suggestions then take over."""
from __future__ import annotations

import re

from .catalog import Command

PREFIX = re.compile(r"^\s*(?:using\s+quality[\s-]*code(?:\s+direct)?|quality[\s-]*code(?:\s+direct)?)\b[\s:,.\-–—]*", re.I)
KEY = re.compile(r"^[A-Z][A-Z0-9_]*-\d+$")
NAME = re.compile(r"^/?(?:quality-code:)?", re.I)


KEYS = re.compile(r"\b[A-Z][A-Z0-9_]*-\d+\b")
PROJECT = re.compile(r"\b[A-Z][A-Z0-9]{1,9}\b(?!-)")

# What a plain request means, in plain words: (command, what the person says, arguments added). A request that fits one command runs it; fitting several, or none, asks.
INTENTS: list[tuple[str, re.Pattern, str]] = [
    ("ticket", re.compile(r"\b(evaluat\w*|scor\w*|readiness|grade|rate)\b|\bready (for|to)\b|\bis (it|this|the ticket) ready\b", re.I), "--eval"),
    ("spec", re.compile(r"\b(write|writes|create|generate|make|add|build|draft)\b[^.]*?\b(tests?|specs?)\b(?!\s*cases?)|\bspec\b", re.I), ""),
    ("xray", re.compile(r"\bxray\b|\btest\s*cases?\b", re.I), ""),
    ("qa", re.compile(r"\bqa\b|\bmanual tests?\b|\btest execution\b|\bdefects?\b|\bretest\b", re.I), ""),
    ("transcript-goal", re.compile(r"\b(transcript|sprint goal|sprint planning|planning meeting)\b", re.I), ""),
    ("check", re.compile(r"\b(check|verify|review|audit|mutation|grade)\b[^.]*?\b(tests?|suite|specs?|quality|branch)\b", re.I), ""),
    ("ci", re.compile(r"\b(ci|pipeline|gitlab ci|github actions|quality gate)\b", re.I), ""),
    ("seed", re.compile(r"\b(seed|mock data|sample data|fake data)\b", re.I), ""),
    ("routine", re.compile(r"\b(routine|schedule|nightly|flaky|stability|every (day|night|morning))\b", re.I), ""),
    ("report", re.compile(r"\b(report|kpi|kpis|cost|usage)\b", re.I), ""),
    ("setup", re.compile(r"\b(set ?up|install|configure the project|get started)\b", re.I), ""),
    ("config", re.compile(r"\b(settings?|config|configuration)\b", re.I), ""),
    ("clean", re.compile(r"\b(clean|remove what|uninstall|delete the files)\b", re.I), ""),
    ("update", re.compile(r"\b(update|new version|latest version|upgrade)\b", re.I), ""),
    ("help", re.compile(r"\bhelp\b|\bwhat can (you|i|we)\b|\bwhat do you (do|offer)\b|\bhow do i\b", re.I), ""),
]
SHOW = re.compile(r"\b(ticket|story|issue|show|find|read|open|look|summar\w*|what is|tell me about)\b", re.I)


def understand(rest: str, by_name: dict[str, Command]) -> tuple[list[tuple[Command, str]], str]:
    """The commands a plain request could mean, with the arguments each takes: (candidates, the keys and words kept as arguments)."""
    keys = KEYS.findall(rest)
    base = " ".join(dict.fromkeys(keys))
    hits: list[tuple[Command, str]] = []
    for name, pat, extra in INTENTS:
        if name in by_name and pat.search(rest):
            args = " ".join(x for x in (base, extra) if x)
            if name == "ticket" and not base:  # scoring a project: "PFO" alone is the project key
                proj = [w for w in PROJECT.findall(rest) if w.isupper() and w not in {"QA", "CI", "KPI", "MR", "PR", "UI", "API"}]
                args = " ".join(x for x in (proj[0] if proj else "", extra) if x)
            hits.append((by_name[name], args))
    names = {c.name for c, _ in hits}
    if "ticket" in by_name and not hits and keys and SHOW.search(rest) or ("ticket" in by_name and not hits and keys):
        hits.append((by_name["ticket"], base))  # a key and no other request: look the ticket up
    if len(names) > 1 and names - {"help"} != names:
        hits = [h for h in hits if h[0].name != "help"]
    return hits, base


ARG = re.compile(r"^(--?[\w-]+(=\S*)?|[A-Z][A-Z0-9_]*-\d+|[A-Z][A-Z0-9]*|\d+|\S*[/\\.]\S*|@\S+|https?://\S+)$")


def looks_like_arguments(words: list[str]) -> bool:
    """Flags, keys, numbers, paths and addresses are arguments; ordinary words are a sentence, which is read as a request."""
    after_flag = False  # the word after a flag is its value (`--layer unit`), whatever it is
    for w in words:
        if not after_flag and not ARG.match(w.strip(",;")):
            return False
        after_flag = w.startswith("-") and "=" not in w
    return True


def route(text: str, commands: list[Command]) -> tuple[Command | None, str]:
    """(command, arguments) for a request, or (None, rest) when it is not clear which command is meant (the caller then shows the suggestions)."""
    rest = PREFIX.sub("", text or "", count=1).strip()
    by_name = {c.name: c for c in commands}
    if not rest:
        return by_name.get("help"), ""
    words = rest.split()
    first = NAME.sub("", words[0]).strip(":,.").lower()
    if len(words) > 1 and f"{first}-{words[1].lower()}" in by_name and looks_like_arguments(words[2:]):  # "transcript goal"
        return by_name[f"{first}-{words[1].lower()}"], " ".join(words[2:])
    if first in by_name and looks_like_arguments(words[1:]):
        return by_name[first], " ".join(words[1:])
    if KEY.match(words[0].strip(":,.").upper()) and len(words) == 1:  # a bare key means the ticket
        return by_name.get("ticket"), rest
    hits, _ = understand(rest, by_name)
    if len({c.name for c, _ in hits}) == 1:
        return hits[0]
    return None, rest


def candidates(text: str, commands: list[Command]) -> list[Command]:
    """The commands a request could mean when it does not settle on one (for the suggestion), else empty."""
    rest = PREFIX.sub("", text or "", count=1).strip()
    hits, _ = understand(rest, {c.name: c for c in commands})
    return [c for c, _ in hits]


def menu(commands: list[Command], maybe: list[Command] | None = None) -> str:
    """What to say when it is not clear which command is meant: the likely ones first, then everything we offer, with an example each."""
    def line(c: Command) -> str:
        return f"- `Using Quality Code {c.name}`{(' ' + c.argument_hint) if c.argument_hint else ''}: {c.description.split('. ')[0].rstrip('.')}"

    head = "I am not sure which Quality Code command you mean."
    if maybe:
        head += " It could be one of these:\n\n" + "\n".join(line(c) for c in maybe) + "\n\nEverything we offer:"
    else:
        head += " Here is what we offer:"
    return head + "\n\n" + "\n".join(line(c) for c in commands) + "\n\nShow the likely commands as choice cards with the AskUserQuestion picker, the last option \"Other\", and go on with the one they pick. Say it after the keyword, for example `Using Quality Code evaluate ticket PFO-123` or `Using Quality Code write tests for PFO-123`."
