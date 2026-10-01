import { TextField, type TextFieldProps } from './TextField';

type PasswordFieldProps = Omit<TextFieldProps, 'type' | 'autoComplete'> & {
  autoComplete: 'current-password' | 'new-password';
};

export function PasswordField(props: PasswordFieldProps) {
  return <TextField {...props} type="password" />;
}
