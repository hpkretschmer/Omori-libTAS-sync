#!/usr/bin/env python3
"""Compute OMORI's random numbers (Math.random of NW.js 0.29 / V8 6.5) outside the game.

The libTAS fork gives NW.js games the V8 flag --random-seed=<initial time of the
movie>, so Math.random starts from the state (seed, seed), and the value of each call
only depends on its index (the total of the RNG tracer mod).

How V8 6.5 generates Math.random (src/runtime/runtime-maths.cc,
Runtime_GenerateRandomNumbers): with xorshift128+, each value is the low 52 bits of
state0 + state1, divided by 2^52. V8 keeps a cache of 64 doubles: it generates 62
values into it and returns them from the end, so each block of 62 values comes in
reverse order. The 2 last entries of the cache hold state0 and state1, as doubles.
Storing a double replaces any NaN by the canonical NaN (FixedDoubleArray::set), so a
state whose bits are a NaN (exponent all ones, mantissa not 0) becomes
0x7FF8000000000000 after its block.

Commands:
  dump     write the values from an index, one "index value" per line
  search   print the indices from an index whose value matches a condition

Examples:
  rngtool.py search --seed 1 --from 2481 --where "v < 0.01"
  rngtool.py search --seed 1 --from 2481 --where "int(v * 100) == 99"
  rngtool.py dump --seed 1 --from 2481 --count 100000 -o values.txt

Indices are those of the RNG tracer: index 1 is the first call after the mod loaded,
and the sequence starts at index 0 (OMORI calls Math.random once before the mod loads).
"""

import argparse
import sys

MASK64 = (1 << 64) - 1
MANTISSA = (1 << 52) - 1

# Values that V8 generates at once (its cache of 64 doubles holds the state in
# the last 2)
BLOCK = 62

# The NaN that FixedDoubleArray::set stores for any NaN (quiet NaN on x86-64)
CANONICAL_NAN = 0x7FF8000000000000


def step(s0, s1):
    """One step of V8's XorShift128, returns the new (state0, state1)"""
    a, b = s0, s1
    a ^= (a << 23) & MASK64
    a ^= a >> 17
    a ^= b
    a ^= b >> 26
    return b, a


def stored(x):
    """A state as V8 stores it in the cache: a NaN becomes the canonical NaN"""
    if (x >> 52) & 0x7FF == 0x7FF and x & MANTISSA:
        return CANONICAL_NAN
    return x


def values(seed, first_index, start, count):
    """Yields (index, value) for `count` values from index `start`, for the
    sequence of `seed` that starts at index `first_index`"""
    s0 = s1 = seed & MASK64
    index = first_index
    end = start + count
    while index < end:
        block = []
        for _ in range(BLOCK):
            s0, s1 = step(s0, s1)
            block.append(((s0 + s1) & MANTISSA) / float(1 << 52))
        s0, s1 = stored(s0), stored(s1)
        block.reverse()
        for i, v in enumerate(block):
            if start <= index + i < end:
                yield index + i, v
        index += BLOCK


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    for name in ('dump', 'search'):
        p = sub.add_parser(name)
        p.add_argument('--seed', type=int, required=True, help='the initial time of the movie (1 by default in libTAS)')
        p.add_argument('--from', dest='start', type=int, required=True, help='first index')
        p.add_argument('--count', type=int, default=100000, help='number of values')
        p.add_argument('--first-index', type=int, default=0,
                       help='index of the first call of the game (default 0)')
        if name == 'dump':
            p.add_argument('-o', '--output', help='file (default: standard output)')
        else:
            p.add_argument('--where', required=True,
                           help='Python condition on the value v (from 0 to 1) and its index i')
            p.add_argument('--max', type=int, default=50, help='maximum number of results')
    args = parser.parse_args()

    if args.seed == 0:
        sys.exit('V8 ignores the seed 0')
    if args.start < args.first_index:
        sys.exit('The sequence starts at index %d' % args.first_index)
    sequence = values(args.seed, args.first_index, args.start, args.count)

    if args.command == 'dump':
        out = open(args.output, 'w') if args.output else sys.stdout
        for i, v in sequence:
            out.write('%d %.17g\n' % (i, v))
        if args.output:
            out.close()
    else:
        condition = compile(args.where, '--where', 'eval')
        found = 0
        for i, v in sequence:
            if eval(condition, {'int': int, 'abs': abs, 'min': min, 'max': max}, {'v': v, 'i': i}):
                print('%d %.17g  (+%d)' % (i, v, i - args.start))
                found += 1
                if found >= args.max:
                    break
        if not found:
            print('No value matches in %d values' % args.count)


if __name__ == '__main__':
    main()
