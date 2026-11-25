"""Tier 1, Tier 1.5 SMT, Visual, and Tier 2 NLI Check Registry."""

from pramaan.checks.accessibility_contrast import (
    AccessibilityContrastCheck,
    VisualPaletteDriftCheck,
)
from pramaan.checks.claim_algebra import ClaimAlgebraZ3Check, PersistentSmtSolver
from pramaan.checks.claim_slot_nli import ClaimSlotNliCheck
from pramaan.checks.security_hidden_text import SecurityHiddenTextCheck
from pramaan.checks.terminology_banned import TerminologyBannedCheck
from pramaan.checks.trigger_disclaimer import TriggerDisclaimerCheck
from pramaan.checks.unicode_confusable import UnicodeConfusableCheck
from pramaan.checks.voice_readability import VoiceReadabilityCheck

__all__ = [
    "AccessibilityContrastCheck",
    "ClaimAlgebraZ3Check",
    "ClaimSlotNliCheck",
    "PersistentSmtSolver",
    "SecurityHiddenTextCheck",
    "TerminologyBannedCheck",
    "TriggerDisclaimerCheck",
    "UnicodeConfusableCheck",
    "VisualPaletteDriftCheck",
    "VoiceReadabilityCheck",
]
