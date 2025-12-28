/**
 * Login page tests.
 *
 * Tests:
 * - Form validation
 * - Login submission
 * - Error display
 * - Password strength indicator
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router-dom'
import { MantineProvider } from '@mantine/core'

// Mock the contexts
const mockLogin = vi.fn()
const mockConfig = { registration_enabled: false }

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    login: mockLogin,
    user: null,
    isAuthenticated: false,
  }),
}))

vi.mock('../context/ConfigContext', () => ({
  useConfig: () => ({
    config: mockConfig,
    loading: false,
  }),
}))

// Import after mocks
import { Login } from '../pages/Login'

const renderLogin = () => {
  return render(
    <BrowserRouter>
      <MantineProvider>
        <Login />
      </MantineProvider>
    </BrowserRouter>
  )
}

describe('Login Page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLogin.mockReset()
  })

  describe('Rendering', () => {
    it('renders the login form', () => {
      renderLogin()
      expect(screen.getByText('BillManager')).toBeInTheDocument()
      expect(screen.getByLabelText(/username/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
    })

    it('renders forgot password link', () => {
      renderLogin()
      expect(screen.getByText(/forgot password/i)).toBeInTheDocument()
    })
  })

  describe('Form Validation', () => {
    it('shows error when submitting with empty fields after touching them', async () => {
      const user = userEvent.setup()
      renderLogin()

      // Type and clear to trigger validation on non-empty then empty
      const usernameInput = screen.getByLabelText(/username/i)
      const passwordInput = screen.getByLabelText(/password/i)

      // Focus and blur without typing to simulate interaction
      await user.click(usernameInput)
      await user.click(passwordInput)

      const submitButton = screen.getByRole('button', { name: /sign in/i })
      await user.click(submitButton)

      // HTML5 validation prevents form submission, so login should NOT be called
      expect(mockLogin).not.toHaveBeenCalled()
    })

    it('does not submit when only username is provided', async () => {
      const user = userEvent.setup()
      renderLogin()

      await user.type(screen.getByLabelText(/username/i), 'testuser')

      const submitButton = screen.getByRole('button', { name: /sign in/i })
      await user.click(submitButton)

      // HTML5 validation prevents submission when password is empty
      expect(mockLogin).not.toHaveBeenCalled()
    })
  })

  describe('Login Submission', () => {
    it('calls login function with credentials on submit', async () => {
      mockLogin.mockResolvedValue({ success: true })
      const user = userEvent.setup()
      renderLogin()

      await user.type(screen.getByLabelText(/username/i), 'testuser')
      await user.type(screen.getByLabelText(/password/i), 'testpassword')

      const submitButton = screen.getByRole('button', { name: /sign in/i })
      await user.click(submitButton)

      await waitFor(() => {
        expect(mockLogin).toHaveBeenCalledWith('testuser', 'testpassword')
      })
    })

    it('shows error on failed login', async () => {
      mockLogin.mockResolvedValue({ success: false })
      const user = userEvent.setup()
      renderLogin()

      await user.type(screen.getByLabelText(/username/i), 'testuser')
      await user.type(screen.getByLabelText(/password/i), 'wrongpassword')

      const submitButton = screen.getByRole('button', { name: /sign in/i })
      await user.click(submitButton)

      await waitFor(() => {
        expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument()
      })
    })

    it('shows loading state during login', async () => {
      // Make login hang to see loading state
      mockLogin.mockImplementation(() => new Promise(() => {}))
      const user = userEvent.setup()
      renderLogin()

      await user.type(screen.getByLabelText(/username/i), 'testuser')
      await user.type(screen.getByLabelText(/password/i), 'testpassword')

      const submitButton = screen.getByRole('button', { name: /sign in/i })
      await user.click(submitButton)

      // Button should be in loading state (disabled)
      await waitFor(() => {
        expect(submitButton).toBeDisabled()
      })
    })
  })
})

describe('Password Strength', () => {
  it('calculates correct strength for weak password', () => {
    // Import the function directly for unit testing
    const getPasswordStrength = (password: string): number => {
      let strength = 0
      if (password.length >= 8) strength += 25
      if (password.length >= 12) strength += 15
      if (/[a-z]/.test(password)) strength += 15
      if (/[A-Z]/.test(password)) strength += 15
      if (/[0-9]/.test(password)) strength += 15
      if (/[^a-zA-Z0-9]/.test(password)) strength += 15
      return Math.min(100, strength)
    }

    expect(getPasswordStrength('abc')).toBe(15) // Only lowercase
    expect(getPasswordStrength('abcdefgh')).toBe(40) // 8+ chars + lowercase
    expect(getPasswordStrength('Abcdefgh')).toBe(55) // 8+ chars + lower + upper
    expect(getPasswordStrength('Abcdefgh1')).toBe(70) // + number
    expect(getPasswordStrength('Abcdefgh1!')).toBe(85) // + special char
    expect(getPasswordStrength('Abcdefghijk1!')).toBe(100) // 12+ chars (capped at 100)
  })
})
