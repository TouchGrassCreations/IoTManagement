# Contributing Guide

Thank you for contributing to the project! Please follow these guidelines to get started and submit your work.

## Local Development Setup

1. **Prerequisites**: Ensure you have Node.js (v18+ recommended) and `npm` installed.
2. **Clone the repository**:
   ```bash
   git clone <repo-url>
   cd <repo-folder>
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Run development server**:
   ```bash
   npm run dev
   ```

## Running Tests

Before submitting changes, ensure all tests pass:

- **Run all tests**:
  ```bash
  npm test
  ```
- **Type checking and linting**:
  ```bash
  npm run typecheck
  npm run lint
  ```

## Pull Request Guidelines

- **Branch naming**: Use descriptive branch names such as `feature/add-part-scanner` or `fix/camera-detection`.
- **Commit messages**: Use clear, concise commit messages following standard conventions (e.g., `feat: ...`, `fix: ...`, `docs: ...`).
- **PR scope**: Keep pull requests focused on a single concern or feature.
- **Code style & quality**:
  - Adhere to the existing TypeScript conventions and patterns across the codebase.
  - Ensure all type checks and linters pass without warnings or errors.
  - Add or update tests corresponding to your changes where applicable.
- **PR Description**: Include a clear description of the problem solved or feature added, along with testing steps or screenshots if relevant.
