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
        expect(res.error).toBeDefined();
        expect(res.result._id).toBe('outer$101');
        expect(res.result.inner._id).toBe('inner$100');
        expect(res.result.flag).toBeUndefined();
    });

    test('parse block', () => {
        const tlb = fs.readFileSync(path.resolve(fixturesDir, 'block.tlb'), 'utf-8');
        const boc = fs.readFileSync(path.resolve(fixturesDir, 'block.boc'));
        const cell = Cell.fromBoc(boc)[0];
        const program = parseTLB(tlb);
        const res = tryParseCell(cell, program, 'Block');
        expect(res.error).toBeDefined();
    });
});
