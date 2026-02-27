import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Container,
  Paper,
  Title,
  Text,
  TextInput,
  PasswordInput,
  Button,
  Stack,
  Alert,
  Tabs,
  Anchor,
  Group,
  Progress,
  List,
  Box,
} from '@mantine/core';
import {
  IconUser,
  IconMail,
  IconLock,
  IconAlertCircle,
  IconBrandGithub,
} from '@tabler/icons-react';
import { useAuth } from '../context/AuthContext';
import { useConfig } from '../context/ConfigContext';
import { SocialLoginButtons } from '../components/SocialLoginButtons';
import { TwoFactorVerify } from './TwoFactorVerify';
import * as api from '../api/client';

function getPasswordStrength(password: string): number {
  let strength = 0;
  if (password.length >= 8) strength += 25;
  if (password.length >= 12) strength += 15;
  if (/[a-z]/.test(password)) strength += 15;
  if (/[A-Z]/.test(password)) strength += 15;
  if (/[0-9]/.test(password)) strength += 15;
  if (/[^a-zA-Z0-9]/.test(password)) strength += 15;
  return Math.min(100, strength);
}

function getPasswordColor(strength: number): string {
  if (strength < 30) return 'red';
  if (strength < 60) return 'yellow';
  if (strength < 80) return 'blue';
  return 'green';
}

export function Login() {
  const navigate = useNavigate();
  const { login, pending2FA } = useAuth();
  const { config } = useConfig();

  const [activeTab, setActiveTab] = useState<string | null>('login');

  // Check if registration is enabled (defaults to false if config not loaded)
  const registrationEnabled = config?.registration_enabled ?? false;

  // Login state
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // Signup state
  const [signupUsername, setSignupUsername] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('');
  const [signupError, setSignupError] = useState('');
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);

  const passwordStrength = getPasswordStrength(signupPassword);

  // Show 2FA verification page if pending (must be after all hooks)
  if (pending2FA) {
    return <TwoFactorVerify />;
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');

    if (!loginUsername.trim() || !loginPassword.trim()) {
      setLoginError('Username and password are required');
      return;
    }

    setLoginLoading(true);
    try {
      const result = await login(loginUsername, loginPassword);
      if (result.success) {
        // Don't navigate if password change or 2FA is required
        if (!result.requirePasswordChange && !result.require2FA) {
          navigate('/');
        }
        // If require2FA, the component will re-render with pending2FA and show TwoFactorVerify
      } else {
        setLoginError('Invalid credentials');
      }
    } catch {
      setLoginError('Login failed. Please try again.');
    } finally {
      setLoginLoading(false);
    }
  };

  const validateSignup = (): string | null => {
    if (!signupUsername.trim()) return 'Username is required';
    if (signupUsername.length < 3) return 'Username must be at least 3 characters';
    if (!signupEmail.trim()) return 'Email is required';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signupEmail)) return 'Invalid email address';
    if (!signupPassword) return 'Password is required';
    if (signupPassword.length < 8) return 'Password must be at least 8 characters';
    if (!/[a-z]/.test(signupPassword) || !/[A-Z]/.test(signupPassword)) {
      return 'Password must contain both uppercase and lowercase letters';
    }
    if (!/[0-9]/.test(signupPassword)) return 'Password must contain at least one number';
    if (signupPassword !== signupConfirmPassword) return 'Passwords do not match';
    return null;
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignupError('');

    const validationError = validateSignup();
    if (validationError) {
      setSignupError(validationError);
      return;
    }

    setSignupLoading(true);
    try {
      const response = await api.register({
        username: signupUsername,
        email: signupEmail,
        password: signupPassword,
      });
      if (response.success) {
        setSignupSuccess(true);
        window.umami?.track('user_registered');
      } else {
        setSignupError(response.error || 'Registration failed');
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setSignupError(error.response?.data?.error || 'Registration failed. Please try again.');
    } finally {
      setSignupLoading(false);
    }
  };

  if (signupSuccess) {
    return (
      <Box
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #059669 0%, #064e3b 100%)',
        }}
      >
        <Container size={420}>
          <Paper withBorder shadow="xl" p={40} radius="md" style={{ textAlign: 'center' }}>
            <Stack gap="lg">
              <div style={{ fontSize: '48px' }}>📧</div>
              <Title order={2}>Check Your Email</Title>
              <Text c="dimmed">
                We&apos;ve sent a verification link to <strong>{signupEmail}</strong>.
                Please check your inbox and click the link to activate your account.
              </Text>
              <Button onClick={() => { setSignupSuccess(false); setActiveTab('login'); }}>
                Back to Login
              </Button>
            </Stack>
          </Paper>
        </Container>
      </Box>
    );
  }

  return (
    <Box
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #059669 0%, #064e3b 100%)',
      }}
    >
      <Container size={440}>
        <Stack gap="lg" align="center" mb="xl">
          <img src="/logo_icon.svg" alt="BillManager" style={{ width: 100, height: 100 }} />
          <Title
            order={1}
            style={{
              color: 'white',
              fontSize: '2.5rem',
              fontWeight: 700,
              textShadow: '0 2px 4px rgba(0,0,0,0.1)',
            }}
          >
            BillManager
          </Title>
          <Text c="white" size="lg" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.1)' }}>
            Track your bills and income with ease
          </Text>
        </Stack>

        <Paper withBorder shadow="xl" p={30} radius="md">
          <Tabs value={activeTab} onChange={setActiveTab}>
            <Tabs.List grow={registrationEnabled}>
              <Tabs.Tab value="login">Sign In</Tabs.Tab>
              {registrationEnabled && <Tabs.Tab value="signup">Sign Up</Tabs.Tab>}
            </Tabs.List>

            <Tabs.Panel value="login" pt="xl">
              <form onSubmit={handleLogin}>
                <Stack gap="md">
                  {loginError && (
                    <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
                      {loginError}
                    </Alert>
                  )}

                  <TextInput
                    label="Username"
                    placeholder="Enter your username"
                    leftSection={<IconUser size={16} />}
                    value={loginUsername}
                    onChange={(e) => setLoginUsername(e.currentTarget.value)}
                    required
                  />

                  <PasswordInput
                    label="Password"
                    placeholder="Enter your password"
                    leftSection={<IconLock size={16} />}
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.currentTarget.value)}
                    required
                  />

                  <Group justify="space-between">
                    <Anchor component={Link} to="/forgot-password" size="sm">
                      Forgot password?
                    </Anchor>
                  </Group>

                  <Button type="submit" fullWidth loading={loginLoading} size="md">
                    Sign In
                  </Button>

                  {config?.oauth_providers && config.oauth_providers.length > 0 && (
                    <SocialLoginButtons
                      providers={config.oauth_providers}
                      onError={setLoginError}
                    />
                  )}
                </Stack>
              </form>
            </Tabs.Panel>

            {registrationEnabled && (
            <Tabs.Panel value="signup" pt="xl">
              <form onSubmit={handleSignup}>
                <Stack gap="md">
                  {signupError && (
                    <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
                      {signupError}
                    </Alert>
                  )}

                  <TextInput
                    label="Username"
                    placeholder="Choose a username"
                    leftSection={<IconUser size={16} />}
                    value={signupUsername}
                    onChange={(e) => setSignupUsername(e.currentTarget.value)}
                    required
                  />

                  <TextInput
                    label="Email"
                    placeholder="your@email.com"
                    leftSection={<IconMail size={16} />}
                    value={signupEmail}
                    onChange={(e) => setSignupEmail(e.currentTarget.value)}
                    type="email"
                    required
                  />

                  <div>
                    <PasswordInput
                      label="Password"
                      placeholder="Create a strong password"
                      leftSection={<IconLock size={16} />}
                      value={signupPassword}
                      onChange={(e) => setSignupPassword(e.currentTarget.value)}
                      required
                    />
                    {signupPassword && (
                      <>
                        <Progress
                          value={passwordStrength}
                          color={getPasswordColor(passwordStrength)}
                          size="xs"
                          mt={5}
                        />
                        <List size="xs" c="dimmed" spacing={0} mt={5}>
                          <List.Item c={signupPassword.length >= 8 ? 'green' : undefined}>
                            At least 8 characters
                          </List.Item>
                          <List.Item
                            c={
                              /[a-z]/.test(signupPassword) && /[A-Z]/.test(signupPassword)
                                ? 'green'
                                : undefined
                            }
                          >
                            Upper and lowercase letters
                          </List.Item>
                          <List.Item c={/[0-9]/.test(signupPassword) ? 'green' : undefined}>
                            At least one number
                          </List.Item>
                        </List>
                      </>
                    )}
                  </div>

                  <PasswordInput
                    label="Confirm Password"
                    placeholder="Confirm your password"
                    leftSection={<IconLock size={16} />}
                    value={signupConfirmPassword}
                    onChange={(e) => setSignupConfirmPassword(e.currentTarget.value)}
                    error={
                      signupConfirmPassword && signupPassword !== signupConfirmPassword
                        ? 'Passwords do not match'
                        : undefined
                    }
                    required
                  />

                  <Button type="submit" fullWidth loading={signupLoading} size="md">
                    Create Account
                  </Button>

                  <Text size="xs" c="dimmed" ta="center">
                    By signing up, you agree to our{' '}
                    <Anchor href="/terms" size="xs">
                      Terms
                    </Anchor>{' '}
                    and{' '}
                    <Anchor href="/privacy" size="xs">
                      Privacy Policy
                    </Anchor>
                  </Text>
                </Stack>
              </form>
            </Tabs.Panel>
            )}
          </Tabs>
        </Paper>

        <Text component="div" c="white" size="sm" ta="center" mt="xl" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.1)' }}>
          Open source •{' '}
          <Anchor
            href="https://github.com/brdweb/billmanager"
            c="white"
            style={{ textDecoration: 'underline' }}
          >
            <Group gap={4} style={{ display: 'inline-flex' }}>
              <IconBrandGithub size={16} />
              <span>View on GitHub</span>
            </Group>
          </Anchor>
        </Text>
      </Container>
    </Box>
  );
}
