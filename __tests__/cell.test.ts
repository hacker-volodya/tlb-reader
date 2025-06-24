import { Builder } from '@ton/core';
import { parseCell, parseTLB } from '../src';

describe('Cell parsing', () => {
    const tlb = 'bool_true$1 = Bool;';
    const program = parseTLB(tlb);

    test('parse simple bool cell', () => {
        const builder = new Builder();
        builder.storeBit(1);
        const cell = builder.endCell();
        const res = parseCell(cell, program, 'Bool');
        expect(res).toEqual({});
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
        expect(res.value.toString()).toBe('7');
    });
});
