# Contributing Guide

Thank you for contributing! Please follow these guidelines to get started and submit your work.

## Local Development Setup

1. **Prerequisites**: Node.js `>=22.13.0` (see `engines` in `package.json`).
2. **Clone the repository**:
   ```bash
   git clone https://github.com/TouchGrassCreations/IoTManagement.git
   cd IoTManagement
   ```
3. **Install and configure**:
   ```bash
   npm install
   cp .env.example .env.local   # fill in GEMINI_API_KEY and CONFIRMATION_TOKEN_SECRET
   ```
   See the Configuration table in the README for every variable.
4. **Run the development server**:
   ```bash
   npm run dev
   ```

## Running Tests

CI runs lint, typecheck, unit tests and the build on every pull request. Run the same locally:

```bash
npm run lint
npm run typecheck
npm run test:unit   # unit and persistence tests
npm test            # builds, then server-renders the app and checks the HTML
```

## Pull Request Guidelines

- **Commit messages**: clear and concise, e.g. `feat: ...`, `fix: ...`, `docs: ...`.
- **PR scope**: keep each pull request to a single concern or feature.
- **Code style & quality**:
  - Follow the existing TypeScript conventions and patterns in the codebase.
  - Make sure lint and typecheck pass without warnings or errors.
  - Add or update tests for your changes where applicable.
- **PR description**: say what problem it solves, and include testing steps or screenshots if relevant.
