export default {
  source: ['design-tokens/*.tokens.json'],
  hooks: {
    formats: {
      'css/themed': ({ dictionary }) => {
        const tokens = dictionary.allTokens;
        const render = (dark) =>
          tokens
            .map((token) => {
              const value = dark ? token.original.$extensions?.theme?.dark : token.original.$value;
              if (!value) return null;
              const cssValue = String(value).replace(
                /\{([^}]+)\}/g,
                (_, path) => `var(--${path.replaceAll('.', '-')})`
              );
              return `  --${token.name}: ${cssValue};`;
            })
            .filter(Boolean)
            .join('\n');
        return `:root, [data-theme="light"] {\n${render(false)}\n}\n[data-theme="dark"] {\n${render(true)}\n}\n`;
      }
    }
  },
  platforms: {
    css: {
      transformGroup: 'css',
      buildPath: 'design-tokens/dist/',
      files: [{ destination: 'tokens.css', format: 'css/themed' }]
    }
  }
};
