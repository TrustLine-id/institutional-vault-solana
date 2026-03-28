import React from 'react';
import { render, screen } from '@testing-library/react';
import App from './App';

test('renders app title', () => {
  render(<App />);
  const title = screen.getByText(/trustline protected solana vault/i);
  expect(title).toBeInTheDocument();
});
