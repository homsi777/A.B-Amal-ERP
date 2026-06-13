/** تعريف ثيمات الواجهة — مصدر واحد للمتغيرات المطبَّقة على document.documentElement */

export type ThemePresetId =
  | 'alamal-denim'
  | 'indigo-classic'
  | 'ocean-teal'
  | 'amber-warm'
  | 'ruby-professional';

export type AppearanceMode = 'light' | 'dark';

export type ArabicFontId = 'cairo' | 'tajawal' | 'noto-naskh' | 'ibm-plex-arabic';

/** أسماء العرض العربية للخطوط */
export const ARABIC_FONT_LABELS: Record<ArabicFontId, string> = {
  cairo: 'Cairo — عصري ومتوازن',
  tajawal: 'Tajawal — واضح للواجهات',
  'noto-naskh': 'Noto Naskh Arabic — قراءة طويلة',
  'ibm-plex-arabic': 'IBM Plex Arabic — مهني وهادئ'
};

export const FONT_CSS_STACK: Record<ArabicFontId, string> = {
  cairo: '"Cairo", ui-sans-serif, system-ui, sans-serif',
  tajawal: '"Tajawal", ui-sans-serif, system-ui, sans-serif',
  'noto-naskh': '"Noto Naskh Arabic", ui-serif, serif',
  'ibm-plex-arabic': '"IBM Plex Sans Arabic", ui-sans-serif, system-ui, sans-serif'
};

export const THEME_META: Record<
  ThemePresetId,
  { labelAr: string; descriptionAr: string; previewGradient: string }
> = {
  'alamal-denim': {
    labelAr: 'ALamal — دينيم وذهبي',
    descriptionAr: 'هوية Obada الافتراضية — ألوان العلامة للجملة والدينيم.',
    previewGradient: 'linear-gradient(135deg, #8B7355 0%, #B8956B 45%, #f5efe6 100%)',
  },
  'indigo-classic': {
    labelAr: 'كلاسيكي إنديجو',
    descriptionAr: 'الأسلوب الحالي للمشروع — هادئ واحترافي.',
    previewGradient: 'linear-gradient(135deg, #4f46e5 0%, #818cf8 50%, #c7d2fe 100%)'
  },
  'ocean-teal': {
    labelAr: 'محيط تركواز',
    descriptionAr: 'لمسة باردة مناسبة للمخزون والعمليات اليومية.',
    previewGradient: 'linear-gradient(135deg, #0d9488 0%, #2dd4bf 45%, #ccfbf1 100%)'
  },
  'amber-warm': {
    labelAr: 'دفء كهرماني',
    descriptionAr: 'دفء خفيف للوحة التحكم دون إرهاق للعين.',
    previewGradient: 'linear-gradient(135deg, #d97706 0%, #fbbf24 40%, #fef3c7 100%)'
  },
  'ruby-professional': {
    labelAr: 'عنابي مهني',
    descriptionAr: 'حدة مهنية مع الحفاظ على وضوح النصوص والأيقونات.',
    previewGradient: 'linear-gradient(135deg, #be123c 0%, #fb7185 45%, #ffe4e6 100%)'
  }
};

/** متغيرات CSS للثيمات — لا تُستخدم أسماء Tailwind الفعلية لتجنّب كسر الشجرة عند التعديل */
export const THEME_CSS_VARS: Record<ThemePresetId, Record<AppearanceMode, Record<string, string>>> = {
  'alamal-denim': {
    light: {
      '--ui-accent': '#B8956B',
      '--ui-accent-hover': '#9A7A52',
      '--ui-accent-muted': '#C4A574',
      '--ui-accent-soft-bg': '#f8f3ec',
      '--ui-accent-soft-bg-strong': '#efe4d4',
      '--ui-accent-border': '#dcc9a8',
      '--ui-logo-bg': '#000000',
      '--ui-nav-active-bg': '#f8f3ec',
      '--ui-nav-active-text': '#5c4a32',
      '--ui-nav-active-border': '#dcc9a8',
      '--ui-nav-active-icon': '#8B7355',
      '--ui-dropdown-hover-bg': '#f8f3ec',
      '--ui-mobile-accent-border': '#B8956B',
      '--surface-header': '#ffffff',
      '--surface-muted-nav': '#faf8f5',
      '--surface-mobile-shell': '#faf8f5',
      '--border-default': '#e8dfd2',
      '--border-subtle': '#f3ede4',
      '--page-bg': '#faf8f5',
      '--text-primary': '#1a1612',
      '--text-muted': '#6b5d4d',
      '--text-heading': '#2d2419',
      '--scrollbar-track': '#f3ede4',
      '--scrollbar-thumb': '#c9b89a',
    },
    dark: {
      '--ui-accent': '#C4A574',
      '--ui-accent-hover': '#D4B88A',
      '--ui-accent-muted': '#B8956B',
      '--ui-accent-soft-bg': 'rgba(184, 149, 107, 0.2)',
      '--ui-accent-soft-bg-strong': 'rgba(184, 149, 107, 0.32)',
      '--ui-accent-border': 'rgba(196, 165, 116, 0.42)',
      '--ui-logo-bg': '#000000',
      '--ui-nav-active-bg': 'rgba(184, 149, 107, 0.24)',
      '--ui-nav-active-text': '#f5efe6',
      '--ui-nav-active-border': 'rgba(196, 165, 116, 0.35)',
      '--ui-nav-active-icon': '#dcc9a8',
      '--ui-dropdown-hover-bg': 'rgba(184, 149, 107, 0.16)',
      '--ui-mobile-accent-border': '#C4A574',
      '--surface-header': '#1a1612',
      '--surface-muted-nav': '#0f0d0a',
      '--surface-mobile-shell': '#0f0d0a',
      '--border-default': '#3d3428',
      '--border-subtle': '#2a231c',
      '--page-bg': '#0f0d0a',
      '--text-primary': '#f5efe6',
      '--text-muted': '#a89882',
      '--text-heading': '#faf8f5',
      '--scrollbar-track': '#2a231c',
      '--scrollbar-thumb': '#5c4a32',
    },
  },
  'indigo-classic': {
    light: {
      '--ui-accent': '#4f46e5',
      '--ui-accent-hover': '#4338ca',
      '--ui-accent-muted': '#6366f1',
      '--ui-accent-soft-bg': '#eef2ff',
      '--ui-accent-soft-bg-strong': '#e0e7ff',
      '--ui-accent-border': '#c7d2fe',
      '--ui-logo-bg': '#4f46e5',
      '--ui-nav-active-bg': '#eef2ff',
      '--ui-nav-active-text': '#3730a3',
      '--ui-nav-active-border': '#c7d2fe',
      '--ui-nav-active-icon': '#4f46e5',
      '--ui-dropdown-hover-bg': '#eef2ff',
      '--ui-mobile-accent-border': '#4f46e5',
      '--surface-header': '#ffffff',
      '--surface-muted-nav': '#f8fafc',
      '--surface-mobile-shell': '#f8fafc',
      '--border-default': '#e2e8f0',
      '--border-subtle': '#f1f5f9',
      '--page-bg': '#f8fafc',
      '--text-primary': '#0f172a',
      '--text-muted': '#64748b',
      '--text-heading': '#1e293b',
      '--scrollbar-track': '#f1f5f9',
      '--scrollbar-thumb': '#cbd5e1'
    },
    dark: {
      '--ui-accent': '#818cf8',
      '--ui-accent-hover': '#a5b4fc',
      '--ui-accent-muted': '#6366f1',
      '--ui-accent-soft-bg': 'rgba(79, 70, 229, 0.22)',
      '--ui-accent-soft-bg-strong': 'rgba(79, 70, 229, 0.35)',
      '--ui-accent-border': 'rgba(129, 140, 248, 0.45)',
      '--ui-logo-bg': '#4338ca',
      '--ui-nav-active-bg': 'rgba(79, 70, 229, 0.28)',
      '--ui-nav-active-text': '#e0e7ff',
      '--ui-nav-active-border': 'rgba(129, 140, 248, 0.35)',
      '--ui-nav-active-icon': '#c7d2fe',
      '--ui-dropdown-hover-bg': 'rgba(79, 70, 229, 0.18)',
      '--ui-mobile-accent-border': '#818cf8',
      '--surface-header': '#0f172a',
      '--surface-muted-nav': '#020617',
      '--surface-mobile-shell': '#020617',
      '--border-default': '#334155',
      '--border-subtle': '#1e293b',
      '--page-bg': '#020617',
      '--text-primary': '#f1f5f9',
      '--text-muted': '#94a3b8',
      '--text-heading': '#f8fafc',
      '--scrollbar-track': '#1e293b',
      '--scrollbar-thumb': '#475569'
    }
  },
  'ocean-teal': {
    light: {
      '--ui-accent': '#0d9488',
      '--ui-accent-hover': '#0f766e',
      '--ui-accent-muted': '#14b8a6',
      '--ui-accent-soft-bg': '#f0fdfa',
      '--ui-accent-soft-bg-strong': '#ccfbf1',
      '--ui-accent-border': '#99f6e4',
      '--ui-logo-bg': '#0d9488',
      '--ui-nav-active-bg': '#ecfdf5',
      '--ui-nav-active-text': '#115e59',
      '--ui-nav-active-border': '#99f6e4',
      '--ui-nav-active-icon': '#0d9488',
      '--ui-dropdown-hover-bg': '#f0fdfa',
      '--ui-mobile-accent-border': '#0d9488',
      '--surface-header': '#ffffff',
      '--surface-muted-nav': '#f8fafc',
      '--surface-mobile-shell': '#f8fafc',
      '--border-default': '#e2e8f0',
      '--border-subtle': '#f1f5f9',
      '--page-bg': '#f8fafc',
      '--text-primary': '#0f172a',
      '--text-muted': '#64748b',
      '--text-heading': '#134e4a',
      '--scrollbar-track': '#f1f5f9',
      '--scrollbar-thumb': '#cbd5e1'
    },
    dark: {
      '--ui-accent': '#2dd4bf',
      '--ui-accent-hover': '#5eead4',
      '--ui-accent-muted': '#14b8a6',
      '--ui-accent-soft-bg': 'rgba(13, 148, 136, 0.22)',
      '--ui-accent-soft-bg-strong': 'rgba(13, 148, 136, 0.38)',
      '--ui-accent-border': 'rgba(45, 212, 191, 0.45)',
      '--ui-logo-bg': '#0f766e',
      '--ui-nav-active-bg': 'rgba(13, 148, 136, 0.26)',
      '--ui-nav-active-text': '#ccfbf1',
      '--ui-nav-active-border': 'rgba(45, 212, 191, 0.35)',
      '--ui-nav-active-icon': '#99f6e4',
      '--ui-dropdown-hover-bg': 'rgba(13, 148, 136, 0.18)',
      '--ui-mobile-accent-border': '#2dd4bf',
      '--surface-header': '#0f172a',
      '--surface-muted-nav': '#020617',
      '--surface-mobile-shell': '#020617',
      '--border-default': '#334155',
      '--border-subtle': '#1e293b',
      '--page-bg': '#020617',
      '--text-primary': '#f1f5f9',
      '--text-muted': '#94a3b8',
      '--text-heading': '#ecfdf5',
      '--scrollbar-track': '#1e293b',
      '--scrollbar-thumb': '#475569'
    }
  },
  'amber-warm': {
    light: {
      '--ui-accent': '#d97706',
      '--ui-accent-hover': '#b45309',
      '--ui-accent-muted': '#f59e0b',
      '--ui-accent-soft-bg': '#fffbeb',
      '--ui-accent-soft-bg-strong': '#fef3c7',
      '--ui-accent-border': '#fcd34d',
      '--ui-logo-bg': '#d97706',
      '--ui-nav-active-bg': '#fffbeb',
      '--ui-nav-active-text': '#92400e',
      '--ui-nav-active-border': '#fcd34d',
      '--ui-nav-active-icon': '#d97706',
      '--ui-dropdown-hover-bg': '#fffbeb',
      '--ui-mobile-accent-border': '#d97706',
      '--surface-header': '#ffffff',
      '--surface-muted-nav': '#fafaf9',
      '--surface-mobile-shell': '#fafaf9',
      '--border-default': '#e7e5e4',
      '--border-subtle': '#f5f5f4',
      '--page-bg': '#fafaf9',
      '--text-primary': '#1c1917',
      '--text-muted': '#78716c',
      '--text-heading': '#292524',
      '--scrollbar-track': '#f5f5f4',
      '--scrollbar-thumb': '#d6d3d1'
    },
    dark: {
      '--ui-accent': '#fbbf24',
      '--ui-accent-hover': '#fcd34d',
      '--ui-accent-muted': '#f59e0b',
      '--ui-accent-soft-bg': 'rgba(217, 119, 6, 0.22)',
      '--ui-accent-soft-bg-strong': 'rgba(217, 119, 6, 0.38)',
      '--ui-accent-border': 'rgba(251, 191, 36, 0.45)',
      '--ui-logo-bg': '#b45309',
      '--ui-nav-active-bg': 'rgba(217, 119, 6, 0.26)',
      '--ui-nav-active-text': '#fef3c7',
      '--ui-nav-active-border': 'rgba(251, 191, 36, 0.35)',
      '--ui-nav-active-icon': '#fde68a',
      '--ui-dropdown-hover-bg': 'rgba(217, 119, 6, 0.18)',
      '--ui-mobile-accent-border': '#fbbf24',
      '--surface-header': '#1c1917',
      '--surface-muted-nav': '#0c0a09',
      '--surface-mobile-shell': '#0c0a09',
      '--border-default': '#44403c',
      '--border-subtle': '#292524',
      '--page-bg': '#0c0a09',
      '--text-primary': '#fafaf9',
      '--text-muted': '#a8a29e',
      '--text-heading': '#fafaf9',
      '--scrollbar-track': '#292524',
      '--scrollbar-thumb': '#57534e'
    }
  },
  'ruby-professional': {
    light: {
      '--ui-accent': '#be123c',
      '--ui-accent-hover': '#9f1239',
      '--ui-accent-muted': '#e11d48',
      '--ui-accent-soft-bg': '#fff1f2',
      '--ui-accent-soft-bg-strong': '#ffe4e6',
      '--ui-accent-border': '#fda4af',
      '--ui-logo-bg': '#be123c',
      '--ui-nav-active-bg': '#fff1f2',
      '--ui-nav-active-text': '#9f1239',
      '--ui-nav-active-border': '#fecdd3',
      '--ui-nav-active-icon': '#be123c',
      '--ui-dropdown-hover-bg': '#fff1f2',
      '--ui-mobile-accent-border': '#be123c',
      '--surface-header': '#ffffff',
      '--surface-muted-nav': '#fafafa',
      '--surface-mobile-shell': '#fafafa',
      '--border-default': '#e4e4e7',
      '--border-subtle': '#f4f4f5',
      '--page-bg': '#fafafa',
      '--text-primary': '#18181b',
      '--text-muted': '#71717a',
      '--text-heading': '#27272a',
      '--scrollbar-track': '#f4f4f5',
      '--scrollbar-thumb': '#d4d4d8'
    },
    dark: {
      '--ui-accent': '#fb7185',
      '--ui-accent-hover': '#fda4af',
      '--ui-accent-muted': '#f43f5e',
      '--ui-accent-soft-bg': 'rgba(190, 18, 60, 0.22)',
      '--ui-accent-soft-bg-strong': 'rgba(190, 18, 60, 0.38)',
      '--ui-accent-border': 'rgba(251, 113, 133, 0.45)',
      '--ui-logo-bg': '#9f1239',
      '--ui-nav-active-bg': 'rgba(190, 18, 60, 0.26)',
      '--ui-nav-active-text': '#ffe4e6',
      '--ui-nav-active-border': 'rgba(251, 113, 133, 0.35)',
      '--ui-nav-active-icon': '#fecdd3',
      '--ui-dropdown-hover-bg': 'rgba(190, 18, 60, 0.18)',
      '--ui-mobile-accent-border': '#fb7185',
      '--surface-header': '#18181b',
      '--surface-muted-nav': '#09090b',
      '--surface-mobile-shell': '#09090b',
      '--border-default': '#3f3f46',
      '--border-subtle': '#27272a',
      '--page-bg': '#09090b',
      '--text-primary': '#fafafa',
      '--text-muted': '#a1a1aa',
      '--text-heading': '#fafafa',
      '--scrollbar-track': '#27272a',
      '--scrollbar-thumb': '#52525b'
    }
  }
};
