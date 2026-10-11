"""One allowance, in money, for every supplier and every part."""

from decimal import Decimal

# A gap below one cent on the line is rounding. The same number is used for sums.
ALLOWANCE = Decimal("0.01")
