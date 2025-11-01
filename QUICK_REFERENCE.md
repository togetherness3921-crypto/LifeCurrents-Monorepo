# Chat Bubble CSS - Quick Reference Guide

## 🚀 Quick Start

The new chat bubble system uses three CSS classes:

```jsx
<div className="chat-message-user">
  <div className="chat-message-container">
    <div className="chat-bubble">
      <div className="chat-bubble-content">
        Your message here
      </div>
    </div>
  </div>
</div>
```

## 📋 Class Reference

### `.chat-message-user` / `.chat-message-assistant`
**Purpose**: Controls message alignment
**Applied to**: Outermost wrapper

```css
.chat-message-user .chat-message-container {
  justify-content: flex-end;  /* Right-align user messages */
}

.chat-message-assistant .chat-message-container {
  justify-content: flex-start;  /* Left-align assistant messages */
}
```

### `.chat-message-container`
**Purpose**: Performance optimization layer
**Key Features**: CSS containment, GPU acceleration

```css
contain: layout style;           /* Isolate layout calculations */
inline-size: 100%;               /* Full width available */
overflow: clip;                  /* Prevent overflow */
will-change: transform;          /* GPU hint */
```

### `.chat-bubble`
**Purpose**: Visual bubble with adaptive sizing
**Key Features**: Intrinsic sizing, responsive constraints

```css
inline-size: fit-content;                    /* Adapt to content */
max-inline-size: clamp(10ch, 90%, 100%);    /* Responsive limit */
contain: layout paint style;                 /* Full optimization */
```

### `.chat-bubble-content`
**Purpose**: Typography and readability layer
**Key Features**: Optimal reading width, fluid typography

```css
max-inline-size: 65ch;                      /* 45-75 chars/line */
font-size: clamp(0.875rem, 2vw, 1rem);     /* Fluid scaling */
```

## 🎨 Styling the Bubbles

Add visual styles to `.chat-bubble`:

```jsx
<div className="chat-bubble bg-primary text-primary-foreground rounded-lg">
  {/* User message */}
</div>

<div className="chat-bubble bg-transparent border border-border text-foreground rounded-lg">
  {/* Assistant message */}
</div>
```

## 📱 Responsive Breakpoints

| Viewport     | Max Width | Chars | Padding    |
|--------------|-----------|-------|------------|
| ≤ 480px      | 95%       | 55ch  | 0.875rem   |
| 481-767px    | 90%       | 65ch  | 1rem       |
| 768-1023px   | 75%       | 70ch  | 1rem       |
| ≥ 1024px     | 65%       | 70ch  | 1rem       |

## 🔧 Common Customizations

### Change Maximum Width
```css
.chat-bubble {
  max-inline-size: clamp(10ch, 80%, 100%);  /* Change 90% to 80% */
}
```

### Change Reading Width
```css
.chat-bubble-content {
  max-inline-size: 80ch;  /* Change from 65ch to 80ch */
}
```

### Adjust Padding
```css
.chat-bubble {
  padding-inline: 1.5rem;  /* Change from 1rem */
  padding-block: 1rem;     /* Change from 0.75rem */
}
```

### Modify Font Scaling
```css
.chat-bubble-content {
  font-size: clamp(0.875rem, 2.5vw, 1.125rem);  /* Larger text */
}
```

## 🐛 Troubleshooting

### Bubble is Full Width
**Problem**: Bubble takes 100% width
**Solution**: Check that `inline-size: fit-content` is applied

```css
/* Check if this is present */
.chat-bubble {
  inline-size: fit-content;  /* Should be here */
}
```

### Content Overflows
**Problem**: Long words or URLs overflow
**Solution**: Verify overflow handling rules

```css
/* These should be present */
.chat-bubble {
  overflow-wrap: break-word;
  word-break: break-word;
  hyphens: auto;
}
```

### Bubbles Too Narrow on Mobile
**Problem**: Bubbles don't use enough width
**Solution**: Increase mobile max-width

```css
@media (inline-size <= 480px) {
  .chat-bubble {
    max-inline-size: clamp(10ch, 98%, 100%);  /* Increase from 95% */
  }
}
```

### Performance Issues
**Problem**: Layout recalculation is slow
**Solution**: Ensure containment is applied

```css
/* Verify these are present */
.chat-message-container {
  contain: layout style;
}

.chat-bubble {
  contain: layout paint style;
}
```

## 🧪 Testing Checklist

- [ ] Short messages don't span full width
- [ ] Long messages wrap properly
- [ ] No horizontal scrollbars at any width
- [ ] Smooth resize from 300px to 3000px
- [ ] URLs break correctly
- [ ] Code blocks have horizontal scroll
- [ ] Mobile (320px, 375px, 414px) looks good
- [ ] Tablet (768px) looks good
- [ ] Desktop (1024px+) looks good

## 📊 Performance Validation

Use Chrome DevTools to verify performance:

```bash
1. Open DevTools (F12)
2. Go to Performance tab
3. Start recording
4. Resize window or scroll chat
5. Stop recording
6. Check "Layout" and "Paint" times
```

**Expected Results**:
- Layout time: < 100ms per operation
- Paint time: < 50ms per operation
- No layout thrashing
- Smooth 60 FPS scrolling

## 🔍 Browser DevTools Inspection

### Check Containment
```bash
1. Inspect `.chat-message-container`
2. Look for "contain: layout style" in Computed styles
3. Verify no "Layout Boundary Violation" warnings
```

### Check Sizing
```bash
1. Inspect `.chat-bubble`
2. Check Box Model tab
3. Verify width is less than container
4. Check that width changes with content
```

## 💡 Pro Tips

1. **Don't Override `inline-size: fit-content`** - This is core to the system
2. **Use Logical Properties** - Always use `inline-size` not `width`
3. **Test RTL Languages** - Add `dir="rtl"` to test Arabic/Hebrew
4. **Monitor Performance** - Use Chrome's "Rendering" tab to see containment
5. **Keep Character Limits** - 45-75 characters per line for readability

## 🎯 Key Principles

1. **Content First**: Bubble adapts to content, not vice versa
2. **Performance First**: CSS containment isolates calculations
3. **Responsive First**: Works at any viewport size
4. **Future-Proof**: Uses modern standards (containment, logical properties)
5. **Accessible**: Proper semantic structure and screen reader support

## 📚 Further Reading

- [CSS Containment - MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment)
- [Logical Properties - web.dev](https://web.dev/learn/css/logical-properties)
- [Intrinsic Sizing - Smashing Magazine](https://www.smashingmagazine.com/2024/03/modern-css-tooltips-speech-bubbles-part1/)

## 🆘 Getting Help

If you encounter issues:

1. Check browser console for CSS errors
2. Verify all classes are applied in correct order
3. Ensure `custom-styles.css` is imported
4. Test in Chrome DevTools mobile emulator
5. Compare with `test-chat-bubbles.html` reference

## 📝 Minimal Example

```jsx
import React from 'react';

function ChatMessage({ text, isUser }) {
  return (
    <div className={isUser ? 'chat-message-user' : 'chat-message-assistant'}>
      <div className="chat-message-container">
        <div className={`chat-bubble ${isUser ? 'bg-primary' : 'bg-muted'} rounded-lg`}>
          <div className="chat-bubble-content">
            {text}
          </div>
        </div>
      </div>
    </div>
  );
}
```

---

**Remember**: The system is designed to work out-of-the-box. Only customize if you have specific design requirements!
