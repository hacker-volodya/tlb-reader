import { Builder, Cell } from '@ton/core';
import { parseCell, parseTLB, tryParseCell } from '../src';
import fs from 'fs';
import path from 'path';

const fixturesDir = path.resolve(__dirname, 'fixtures');

describe('Cell parsing', () => {
    const tlb = 'bool_true$1 = Bool;';
    const program = parseTLB(tlb);

    test('parse simple bool cell', () => {
        const builder = new Builder();
        builder.storeBit(1);
        const cell = builder.endCell();
        const res = parseCell(cell, program, 'Bool');
        expect(res._id).toBe('bool_true$1');
    });

    test('parse nested structure', () => {
        const tlb2 = `inner$100 value:uint32 = Inner; outer$101 inner:^Inner flag:Bool = Outer;`;
        const defs = parseTLB(tlb2);

        const innerBuilder = new Builder();
        innerBuilder.storeUint(0b100, 3);
        innerBuilder.storeUint(7, 32);
        const inner = innerBuilder.endCell();

        const outerBuilder = new Builder();
        outerBuilder.storeUint(0b101, 3);
        outerBuilder.storeRef(inner);
        outerBuilder.storeBit(1);
        const outer = outerBuilder.endCell();

        const res = parseCell(outer, defs, 'outer');
        expect(res._id).toBe('outer$101');
        expect(res.inner._id).toBe('inner$100');
        expect(res.inner.value.toString()).toBe('7');
        expect(res.flag).toBe(true);
    });

    test('parse generic maybe cell', () => {
        const tlb3 = 'nothing$0 {X:Type} = Maybe X; just$1 {X:Type} value:X = Maybe X;';
        const defs = parseTLB(tlb3);

        const builder = new Builder();
        builder.storeBit(1); // tag for just
        builder.storeUint(7, 32);
        const cell = builder.endCell();

        const res = parseCell(cell, defs, 'Maybe', [new (require('@ton-community/tlb-parser').NameExpr)('uint32')]);
        expect(res._id).toBe('just$1');
        expect(res.value.toString()).toBe('7');
    });

    test('conditional field parsing', () => {
        const tlb4 = 'foo$_ flag:Bool value:flag?uint8 = Foo;';
        const defs = parseTLB(tlb4);

        const b1 = new Builder();
        b1.storeBit(1); // flag
        b1.storeUint(17, 8);
        const c1 = b1.endCell();

        const r1 = parseCell(c1, defs, 'foo');
        expect(r1.flag).toBe(true);
        expect(r1.value.toString()).toBe('17');

        const b2 = new Builder();
        b2.storeBit(0); // flag
        const c2 = b2.endCell();

        const r2 = parseCell(c2, defs, 'foo');
        expect(r2.flag).toBe(false);
        expect(r2.value).toBeUndefined();
    });

    test('partial result on failure', () => {
        const tlb2 = `inner$100 value:uint32 = Inner; outer$101 inner:^Inner flag:Bool = Outer;`;
        const defs = parseTLB(tlb2);

        const innerBuilder = new Builder();
        innerBuilder.storeUint(0b100, 3);
        innerBuilder.storeUint(7, 32);
        const inner = innerBuilder.endCell();

        const outerBuilder = new Builder();
        outerBuilder.storeUint(0b101, 3);
        outerBuilder.storeRef(inner);
        // omit flag bit to trigger failure
        const outer = outerBuilder.endCell();

        const res = tryParseCell(outer, defs, 'Outer');
        expect(res.result._id).toBe('outer$101');
        expect(res.result.inner._id).toBe('inner$100');
        expect(res.result.flag).toBeUndefined();
        expect(res.result._error).toBeDefined();
        expect(res.result._remaining).toBeDefined();
        expect(Array.isArray(res.errors)).toBe(true);
    });

    test('continue parsing after ref failure', () => {
        const tlb2 = `inner$100 value:uint8 flag:Bool = Inner; outer$101 inner:^Inner other:uint8 = Outer;`;
        const defs = parseTLB(tlb2);

        const badInnerBuilder = new Builder();
        badInnerBuilder.storeUint(0b100, 3);
        badInnerBuilder.storeUint(7, 8); // missing flag bit
        const badInner = badInnerBuilder.endCell();

        const outerBuilder = new Builder();
        outerBuilder.storeUint(0b101, 3);
        outerBuilder.storeRef(badInner);
        outerBuilder.storeUint(9, 8);
        const outer = outerBuilder.endCell();

        const res = parseCell(outer, defs, 'Outer');
        expect(res._id).toBe('outer$101');
        expect(res.other.toString()).toBe('9');
        expect(res.inner._error).toBeDefined();
        expect(res.inner._remaining).toBeDefined();
    });

    test('parse block', () => {
        const tlb = fs.readFileSync(path.resolve(fixturesDir, 'block.tlb'), 'utf-8');
        const boc = fs.readFileSync(path.resolve(fixturesDir, 'block.boc'));
        const cell = Cell.fromBoc(boc)[0];
        const program = parseTLB(tlb);
        const res = tryParseCell(cell, program, 'Block');
        expect(res.result._id).toBe('block#11ef55aa');
    });
});
