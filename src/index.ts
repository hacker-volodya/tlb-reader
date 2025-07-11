import { Cell, Slice } from '@ton/core';
import {
    ast as parseTLB,
    Program,
    Declaration,
    FieldDefinition,
    FieldBuiltinDef,
    FieldCurlyExprDef,
    FieldAnonymousDef,
    FieldNamedDef,
    FieldExprDef,
    NameExpr,
    NumberExpr,
    BuiltinOneArgExpr,
    CombinatorExpr,
    CellRefExpr,
    TypeExpr,
    CondExpr,
    BuiltinZeroArgs,
    MathExpr,
} from '@ton-community/tlb-parser';

export { parseTLB };

export class ParseError extends Error {
    partial: any;
    remaining: Slice;

    constructor(message: string, partial: any, remaining: Slice) {
        super(message);
        this.partial = partial;
        this.remaining = remaining.clone();
    }
}

export function tryParseCell(
    cell: Cell,
    program: Program,
    root: string,
    args: TypeExpr[] = [],
): { result: any; errors?: any[] } {
    const slice = cell.beginParse(true);
    try {
        const result = parseByType(slice, root, program, args, {});
        const errors = gatherErrors(result);
        return errors.length > 0 ? { result, errors } : { result };
    } catch (e: any) {
        let result: any;
        if (e instanceof ParseError) {
            result = { ...e.partial, _error: e.message, _remaining: e.remaining.clone() };
        } else {
            result = { _error: String(e), _remaining: slice.clone() };
        }
        const errors = gatherErrors(result);
        return { result, errors };
    }
}

function findConstructor(program: Program, name: string): Declaration | undefined {
    return program.declarations.find(d => d.constructorDef.name === name);
}

function findCombinators(program: Program, name: string): Declaration[] {
    return program.declarations.filter(d => d.combinator.name === name);
}

function parseByType(
    slice: Slice,
    name: string,
    program: Program,
    args: TypeExpr[] = [],
    env: Record<string, TypeExpr> = {},
): any {
    const byResult = findCombinators(program, name);
    if (byResult.length > 0) {
        let lastError: any = null;
        for (const d of byResult) {
            if (matchTag(slice, d.constructorDef.tag)) {
                const readerState = (slice as any)._reader.clone();
                const refsState = (slice as any)._refsOffset;
                try {
                    const result = parseDecl(slice, d, program, args, env, true);
                    return result;
                } catch (e: any) {
                    (slice as any)._reader = readerState;
                    (slice as any)._refsOffset = refsState;
                    lastError = e;
                }
            }
        }
        if (lastError) {
            throw lastError;
        }
        throw new ParseError('No matching constructor for ' + name, {}, slice.clone());
    }
    const cons = findConstructor(program, name);
    if (cons) {
        try {
            return parseDecl(slice, cons, program, args, env, false);
        } catch (e: any) {
            if (e instanceof ParseError) {
                throw e;
            }
            throw new ParseError(String(e), {}, slice.clone());
        }
    }
    throw new ParseError('Type ' + name + ' not found', {}, slice.clone());
}

function parseDecl(
    slice: Slice,
    decl: Declaration,
    program: Program,
    args: TypeExpr[],
    env: Record<string, TypeExpr>,
    readPrefix: boolean,
): any {
    if (readPrefix) {
        readTag(slice, decl.constructorDef.tag);
    }
    const localEnv: Record<string, TypeExpr> = { ...env };
    let idx = 0;
    for (const f of decl.fields) {
        if (f instanceof FieldBuiltinDef && (f.type === 'Type' || f.type === '#')) {
            if (idx < args.length) {
                localEnv[f.name] = args[idx++];
            }
        }
    }
    try {
        const result = parseFields(slice, decl.fields, program, localEnv, {});
        return { ...result, _id: decl.constructorDef.name, _tag: (decl.constructorDef.tag || ''), _type: decl.combinator.name };
    } catch (e: any) {
        if (e instanceof ParseError) {
            if (typeof e.partial === 'object' && e.partial !== null) {
                e.partial = { ...e.partial, _id: decl.constructorDef.name, _tag: (decl.constructorDef.tag || ''), _type: decl.combinator.name };
            }
            throw e;
        }
        throw new ParseError(String(e), { _id: decl.constructorDef.name, _tag: (decl.constructorDef.tag || ''), _type: decl.combinator.name }, slice.clone());
    }
}

function matchTag(slice: Slice, tag: string | null): boolean {
    if (!tag || tag === '#_' || tag === '$_') return true;
    const { bits, value } = parseTag(tag);
    if (bits === 0) return true;
    return slice.preloadUintBig(bits) === value;
}

function readTag(slice: Slice, tag: string | null) {
    if (!tag || tag === '#_' || tag === '$_') return;
    const { bits } = parseTag(tag);
    if (bits > 0) {
        slice.skip(bits);
    }
}

function parseTag(tag: string): { bits: number; value: bigint } {
    if (tag.startsWith('$')) {
        const b = tag.slice(1);
        if (b === '_') return { bits: 0, value: 0n };
        return { bits: b.length, value: BigInt('0b' + b) };
    } else if (tag.startsWith('#')) {
        const h = tag.slice(1);
        if (h === '_') return { bits: 0, value: 0n };
        return { bits: h.length * 4, value: BigInt('0x' + h) };
    }
    return { bits: 0, value: 0n };
}

function parseFields(
    slice: Slice,
    fields: FieldDefinition[],
    program: Program,
    env: Record<string, TypeExpr>,
    parentValues: Record<string, any> = {},
): any {
    const res: any = {};
    for (const f of fields) {
        if (f instanceof FieldBuiltinDef || f instanceof FieldCurlyExprDef) {
            continue;
        } else if (f instanceof FieldNamedDef) {
            try {
                res[f.name] = parseExpr(slice, f.expr, program, env, { ...parentValues, ...res });
            } catch (e: any) {
                if (e instanceof ParseError) {
                    res[f.name] = e.partial;
                    throw new ParseError(e.message, res, e.remaining);
                }
                throw new ParseError(String(e), res, slice.clone());
            }
        } else if (f instanceof FieldExprDef) {
            try {
                res['_'] = parseExpr(slice, f.expr, program, env, { ...parentValues, ...res });
            } catch (e: any) {
                if (e instanceof ParseError) {
                    res['_'] = e.partial;
                    throw new ParseError(e.message, res, e.remaining);
                }
                throw new ParseError(String(e), res, slice.clone());
            }
        } else if (f instanceof FieldAnonymousDef) {
            const subSlice = f.isRef ? slice.loadRef().beginParse(true) : slice;
            if (f.isRef) {
                try {
                    res[f.name || '_'] = parseFields(subSlice, f.fields, program, env, { ...parentValues, ...res });
                } catch (e: any) {
                    if (e instanceof ParseError) {
                        res[f.name || '_'] = { ...e.partial, _error: e.message, _remaining: e.remaining.clone() };
                    } else {
                        res[f.name || '_'] = { _error: String(e), _remaining: subSlice.clone() };
                    }
                }
            } else {
                try {
                    res[f.name || '_'] = parseFields(subSlice, f.fields, program, env, { ...parentValues, ...res });
                } catch (e: any) {
                    if (e instanceof ParseError) {
                        res[f.name || '_'] = e.partial;
                        throw new ParseError(e.message, res, e.remaining);
                    }
                    throw new ParseError(String(e), res, subSlice.clone());
                }
            }
        }
    }
    return res;
}

function resolveTypeExpr(expr: TypeExpr, env: Record<string, TypeExpr>): TypeExpr {
    if (expr instanceof NameExpr && env[expr.name]) {
        return resolveTypeExpr(env[expr.name], env);
    }
    if (expr instanceof CombinatorExpr) {
        const args = expr.args.map(a => resolveTypeExpr(a, env));
        return new CombinatorExpr(expr.name, args);
    }
    return expr;
}

function evalNumericExpr(expr: CondExpr | TypeExpr, env: Record<string, TypeExpr>, values: Record<string, any> = {}): bigint {
    if (expr instanceof NumberExpr) {
        return BigInt(expr.num);
    }
    if (expr instanceof NameExpr) {
        if (env[expr.name]) {
            return evalNumericExpr(env[expr.name], env, values);
        }
        if (Object.prototype.hasOwnProperty.call(values, expr.name)) {
            const v = values[expr.name];
            return typeof v === 'bigint' ? v : BigInt(v);
        }
        throw new Error('Unknown identifier ' + expr.name);
    }
    if (expr instanceof MathExpr) {
        const left = evalNumericExpr(expr.left, env, values);
        const right = evalNumericExpr(expr.right, env, values);
        if (expr.op === '*') {
            return left * right;
        } else if (expr.op === '+') {
            return left + right;
        }
        throw new Error('Unsupported operator ' + expr.op);
    }
    if (expr instanceof CondExpr) {
        const cond = evalNumericExpr(expr.left, env, values);
        let flag: boolean;
        if (expr.dotExpr !== null && expr.dotExpr !== undefined) {
            flag = ((cond >> BigInt(expr.dotExpr)) & 1n) === 1n;
        } else {
            flag = cond !== 0n;
        }
        if (!flag) {
            return 0n;
        }
        return evalNumericExpr(expr.condExpr, env, values);
    }
    throw new Error('Unsupported numeric expression');
}

// Individual expression handlers
function handleCondExpr(
    slice: Slice,
    expr: CondExpr,
    program: Program,
    env: Record<string, TypeExpr>,
    values: Record<string, any>,
): any {
    let condValue: any;
    if (expr.left instanceof NameExpr && Object.prototype.hasOwnProperty.call(values, expr.left.name)) {
        condValue = values[expr.left.name];
    } else {
        condValue = parseExpr(slice, expr.left, program, env, values);
    }
    let flag: boolean;
    if (expr.dotExpr !== null && expr.dotExpr !== undefined) {
        try {
            const num = BigInt(condValue);
            flag = ((num >> BigInt(expr.dotExpr)) & 1n) === 1n;
        } catch {
            flag = false;
        }
    } else {
        flag = Boolean(condValue);
    }
    if (!flag) {
        return undefined;
    }
    return parseExpr(slice, expr.condExpr, program, env, values);
}

function handleCellRefExpr(
    slice: Slice,
    expr: CellRefExpr,
    program: Program,
    env: Record<string, TypeExpr>,
    values: Record<string, any>,
): any {
    const refSlice = slice.loadRef().beginParse(true);
    try {
        return parseExpr(refSlice, expr.expr, program, env, values);
    } catch (e: any) {
        if (e instanceof ParseError) {
            return { ...e.partial, _error: e.message, _remaining: e.remaining.clone() };
        }
        return { _error: String(e), _remaining: refSlice.clone() };
    }
}

function handleBuiltinOneArgExpr(
    slice: Slice,
    expr: BuiltinOneArgExpr,
    program: Program,
    env: Record<string, TypeExpr>,
    values: Record<string, any>,
): any {
    if (expr.name === '##' && expr.arg instanceof NumberExpr) {
        return slice.loadUintBig(expr.arg.num);
    }
    if (expr.name === '#<' || expr.name === '#<=') {
        let limit: number;
        if (expr.arg instanceof NumberExpr) {
            limit = expr.arg.num;
        } else {
            const v = parseExpr(slice.clone(), expr.arg, program, env, values);
            limit = typeof v === 'bigint' ? Number(v) : Number(v);
        }
        const bits = Math.ceil(Math.log2(limit + (expr.name === '#<' ? 0 : 1)));
        return slice.loadUintBig(bits);
    }
    return undefined;
}

function handleCombinatorExpr(
    slice: Slice,
    expr: CombinatorExpr,
    program: Program,
    env: Record<string, TypeExpr>,
    values: Record<string, any>,
): any {
    if ((expr.name === 'uint' || expr.name === 'int' || expr.name === 'bits') && expr.args.length === 1) {
        const bits = Number(evalNumericExpr(expr.args[0], env, values));
        if (expr.name === 'uint') {
            return slice.loadUintBig(bits);
        } else if (expr.name === 'int') {
            return slice.loadIntBig(bits);
        } else {
            return slice.loadBits(bits).toString();
        }
    }
    const args = expr.args.map(a => resolveTypeExpr(a, env));
    return parseByType(slice, expr.name, program, args, env);
}

function handleBitStringMathExpr(
    slice: Slice,
    expr: MathExpr,
    program: Program,
    env: Record<string, TypeExpr>,
    values: Record<string, any>,
): any {
    const len = Number(evalNumericExpr(expr.left, env, values));
    return slice.loadBits(len).toString();
}

function handleNameExpr(
    slice: Slice,
    expr: NameExpr,
    program: Program,
    env: Record<string, TypeExpr>,
    values: Record<string, any>,
): any {
    const n = expr.name;
    if (env[n]) {
        return parseExpr(slice, env[n], program, env, values);
    }
    if (Object.prototype.hasOwnProperty.call(values, n)) {
        return values[n];
    }
    if (n.startsWith('int')) {
        const b = parseInt(n.slice(3), 10);
        if (!isNaN(b)) return slice.loadIntBig(b);
    }
    if (n.startsWith('uint')) {
        const b = parseInt(n.slice(4), 10);
        if (!isNaN(b)) return slice.loadUintBig(b);
    }
    if (n.startsWith('bits')) {
        const b = parseInt(n.slice(4), 10);
        if (!isNaN(b)) return slice.loadBits(b).toString();
    }
    if (n === 'Bool') {
        return slice.loadBit();
    }
    if (n === 'Cell' || n === 'Any') {
        return slice;
    }
    return parseByType(slice, n, program, [], env);
}

function handleNumberExpr(expr: NumberExpr): any {
    return expr.num;
}

function handleBuiltinZeroArgs(slice: Slice, expr: BuiltinZeroArgs): any {
    if (expr.name == '#') {
        // # is an alias for uint32
        return slice.loadUint(32);
    }
    return undefined;
}

function parseExpr(
    slice: Slice,
    expr: CondExpr | TypeExpr,
    program: Program,
    env: Record<string, TypeExpr>,
    values: Record<string, any> = {},
): any {
    try {
        if (expr instanceof MathExpr && expr.op === '*' && expr.right instanceof NameExpr && expr.right.name === 'Bit') {
            return handleBitStringMathExpr(slice, expr, program, env, values);
        }

        switch (true) {
            case expr instanceof CondExpr:
                return handleCondExpr(slice, expr as CondExpr, program, env, values);
            case expr instanceof CellRefExpr:
                return handleCellRefExpr(slice, expr as CellRefExpr, program, env, values);
            case expr instanceof BuiltinOneArgExpr: {
                const r = handleBuiltinOneArgExpr(slice, expr as BuiltinOneArgExpr, program, env, values);
                if (r !== undefined) return r;
                break;
            }
            case expr instanceof CombinatorExpr:
                return handleCombinatorExpr(slice, expr as CombinatorExpr, program, env, values);
            case expr instanceof NameExpr:
                return handleNameExpr(slice, expr as NameExpr, program, env, values);
            case expr instanceof NumberExpr:
                return handleNumberExpr(expr as NumberExpr);
            case expr instanceof BuiltinZeroArgs: {
                const r = handleBuiltinZeroArgs(slice, expr as BuiltinZeroArgs);
                if (r !== undefined) return r;
                break;
            }
        }
        throw new Error(`Unsupported expression ${expr.constructor.name} (${JSON.stringify(expr, (k, v) => k == "parent" ? undefined : v)}) at ${expr.locations.line}:${expr.locations.column}`);
    } catch (e: any) {
        if (e instanceof ParseError) {
            throw e;
        }
        throw new ParseError(String(e), undefined, slice.clone());
    }
}

function gatherErrors(obj: any, path: (string | number)[] = []): any[] {
    if (obj === null || typeof obj !== 'object') return [];
    let res: any[] = [];
    if (Object.prototype.hasOwnProperty.call(obj, '_error')) {
        res.push({ path, message: obj._error, remaining: obj._remaining });
    }
    for (const [k, v] of Object.entries(obj)) {
        if (v && typeof v === 'object') {
            res = res.concat(gatherErrors(v, path.concat(k)));
        }
    }
    return res;
}
