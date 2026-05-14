import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { env } from './env.js';
import { findUserById, upsertUserFromGoogle, type UserRow } from './db.js';

passport.use(
  new GoogleStrategy(
    {
      clientID: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      callbackURL: env.GOOGLE_CALLBACK_URL,
      scope: ['profile', 'email'],
    },
    (_accessToken, _refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        if (!email) {
          return done(new Error('Google account did not return an email'));
        }
        const user = upsertUserFromGoogle({
          google_id: profile.id,
          email,
          name: profile.displayName ?? null,
          picture: profile.photos?.[0]?.value ?? null,
        });
        done(null, user);
      } catch (err) {
        done(err as Error);
      }
    },
  ),
);

passport.serializeUser((user, done) => {
  done(null, (user as UserRow).id);
});

passport.deserializeUser((id: number, done) => {
  try {
    const user = findUserById(id);
    done(null, user ?? false);
  } catch (err) {
    done(err as Error);
  }
});

export { passport };
