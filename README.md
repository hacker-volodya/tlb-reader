# TLB Reader

This library provides a simple parser for the TON TL-B type language and utilities to decode blockchain cells using these definitions.

## Usage

```
import { parseTLB, parseCell } from 'tlb-reader';

const program = parseTLB(tlbText);
// pass either a constructor or combinator name
const data = parseCell(cell, program, 'Block');
console.log(data);
```

## Testing

```
npm install
npm test -- --verbose
```
