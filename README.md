# TLB Reader

This library provides a simple parser for the TON TL-B type language and utilities to decode blockchain cells using these definitions.

## Usage

```
import { parseTLB, parseCell, tryParseCell } from 'tlb-reader';

const program = parseTLB(tlbText);
// pass either a constructor or combinator name
const data = parseCell(cell, program, 'Block');
console.log(data);
// every parsed object now includes an `_id` field with the constructor name
const partial = tryParseCell(cell, program, 'Block');
console.log(partial);
```

## Testing

```
npm install
npm test -- --verbose
```
