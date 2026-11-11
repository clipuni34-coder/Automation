#!/usr/bin/env python3
"""Extract a small, untrusted set of observations from supplied HTML.

This parser does not fetch a page, establish where HTML came from, evaluate a
licence, or approve footage. The calling code is responsible for safe fetching
and MUST keep every result blocked. The standard-library HTML parser keeps page
text out of code execution and limits the amount of structure examined.
"""
import hashlib
import html
import json
import re
import sys
from html.parser import HTMLParser
from urllib.parse import urljoin

MAX_INPUT = 7 * 1024 * 1024
MAX_NODES = 60000
MAX_DEPTH = 256
VOID = frozenset(('area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
                  'meta', 'param', 'source', 'track', 'wbr'))
SUMMARY_URL = 'https://pixabay.com/service/license-summary/'
SECTIONS = ('section-4-cc0-license', 'section-5-content-license', 'section-6-attribution')


def normal(value):
    return re.sub(r'\s+', ' ', str(value or '')).strip()


class Node:
    __slots__ = ('tag', 'attrs', 'duplicates', 'children', 'parent')

    def __init__(self, tag, attrs, parent=None):
        self.tag = tag
        self.attrs = {}
        self.duplicates = set()
        for key, value in attrs:
            key = key.lower()
            if key in self.attrs:
                self.duplicates.add(key)
            self.attrs[key] = value if value is not None else ''
        self.children = []
        self.parent = parent

    def hidden(self):
        node = self
        while node is not None:
            style = node.attrs.get('style', '')
            if node.tag in ('script', 'style', 'template', 'noscript') or 'hidden' in node.attrs:
                return True
            if node.attrs.get('aria-hidden', '').lower() == 'true':
                return True
            if re.search(r'(?:display\s*:\s*none|visibility\s*:\s*hidden)', style, re.I):
                return True
            node = node.parent
        return False

    def visible_text(self):
        parts, pending = [], [self]
        while pending:
            current = pending.pop()
            if isinstance(current, str):
                parts.append(current)
            elif not current.hidden():
                pending.extend(reversed(current.children))
        return normal(' '.join(parts))


class Document(HTMLParser):
    def __init__(self, content):
        super().__init__(convert_charrefs=True)
        self.root = Node('root', [])
        self.stack = [self.root]
        self.nodes = []
        self.feed(content)
        self.close()

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if len(self.nodes) >= MAX_NODES or len(self.stack) >= MAX_DEPTH:
            raise ValueError('document too complex')
        node = Node(tag, attrs, self.stack[-1])
        self.stack[-1].children.append(node)
        self.nodes.append(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag.lower() not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        tag = tag.lower()
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                break

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def json_objects(value):
    pending, objects, seen = [value], [], 0
    while pending:
        seen += 1
        if seen > 20000:
            raise ValueError('JSON-LD too complex')
        current = pending.pop()
        if isinstance(current, dict):
            objects.append(current)
            pending.extend(current.values())
        elif isinstance(current, list):
            pending.extend(current)
    return objects


def video_objects(doc):
    result = []
    for node in doc.nodes:
        if node.tag != 'script' or 'type' in node.duplicates or node.attrs.get('type', '').lower().strip() != 'application/ld+json':
            continue
        raw = ''.join(child for child in node.children if isinstance(child, str)).strip()
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except (ValueError, TypeError):
            # Some archived server-rendered pages entity-encode JSON-LD.
            try:
                data = json.loads(html.unescape(raw))
            except (ValueError, TypeError):
                continue
        for obj in json_objects(data):
            kind = obj.get('@type')
            if kind != 'VideoObject' and not (isinstance(kind, list) and 'VideoObject' in kind):
                continue
            creator = obj.get('creator')
            result.append({
                'acquireLicensePage': obj.get('acquireLicensePage') if isinstance(obj.get('acquireLicensePage'), str) else None,
                'contentUrl': obj.get('contentUrl') if isinstance(obj.get('contentUrl'), str) else None,
                'license': obj.get('license') if isinstance(obj.get('license'), str) else None,
                'creator': creator.get('name') if isinstance(creator, dict) and isinstance(creator.get('name'), str) else None,
                'datePublished': obj.get('datePublished') if isinstance(obj.get('datePublished'), str) else None,
                'uploadDate': obj.get('uploadDate') if isinstance(obj.get('uploadDate'), str) else None,
                'width': obj.get('width'), 'height': obj.get('height')
            })
    return result


def item_observations(doc):
    canonicals, labels, dates = [], [], []
    for node in doc.nodes:
        if node.tag == 'link' and not ({'rel', 'href'} & node.duplicates) and 'canonical' in node.attrs.get('rel', '').lower().split():
            canonicals.append(node.attrs.get('href', ''))
        if node.tag == 'a' and 'href' not in node.duplicates and not node.hidden():
            if urljoin('https://pixabay.com/', node.attrs.get('href', '')) == SUMMARY_URL and node.visible_text() == 'Content License':
                parent_text = node.parent.visible_text() if node.parent else ''
                if parent_text == 'Free for use under the Pixabay Content License':
                    labels.append(parent_text)
        if node.tag == 'div' and not node.hidden():
            children = [child for child in node.children if isinstance(child, Node)]
            if len(children) == 2 and all(child.tag == 'span' for child in children) and children[0].visible_text() == 'Published date':
                dates.append(children[1].visible_text())
    return {'canonicals': canonicals, 'licenseLabels': labels, 'publishedDates': dates, 'videoObjects': video_objects(doc)}


def terms_observations(doc):
    titles = [node.visible_text() for node in doc.nodes if node.tag == 'h1' and not node.hidden()]
    updated = [node.visible_text() for node in doc.nodes if node.tag == 'p' and not node.hidden() and node.visible_text().startswith('Last updated:')]
    sections = {}
    for section in SECTIONS:
        matches = [node for node in doc.nodes if node.attrs.get('id') == section and 'id' not in node.duplicates and node.tag in ('h2', 'h3', 'h4') and not node.hidden()]
        if len(matches) != 1 or not matches[0].parent or matches[0].parent.tag != 'li':
            sections[section] = None
            continue
        text = matches[0].parent.visible_text()
        sections[section] = {'sha256': hashlib.sha256(text.encode('utf-8')).hexdigest(), 'characters': len(text)}
    return {'titles': titles, 'updated': updated, 'sections': sections}


def summary_observations(doc):
    titles = [node.visible_text() for node in doc.nodes if node.tag == 'h1' and not node.hidden()]
    headings = [node.visible_text() for node in doc.nodes if node.tag in ('h2', 'h3', 'h4') and not node.hidden()]
    return {'titles': titles, 'headings': headings}


def main():
    raw = sys.stdin.buffer.read(MAX_INPUT + 1)
    if len(raw) > MAX_INPUT:
        raise ValueError('input too large')
    payload = json.loads(raw)
    if not isinstance(payload, dict) or any(not isinstance(payload.get(k), str) for k in ('item', 'terms', 'summary')):
        raise ValueError('invalid input')
    item, terms, summary = (Document(payload[key]) for key in ('item', 'terms', 'summary'))
    result = {'item': item_observations(item), 'terms': terms_observations(terms), 'summary': summary_observations(summary)}
    sys.stdout.write(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Do not echo untrusted page contents or input to logs.
        sys.stderr.write('Pixabay observation parser could not safely extract this page.\n')
        sys.exit(1)
