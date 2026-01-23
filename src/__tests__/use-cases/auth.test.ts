import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getTestDb } from '../setup';
import { createTestUser } from '../helpers';
import { users } from '@/db/schema';
import { v4 as uuidv4 } from 'uuid';

describe('Use Case: User Authentication', () => {
    describe('User Login', () => {
        it('should find user with valid username', () => {
            const db = getTestDb();
            const user = createTestUser(db, { name: 'testuser', pin: '1234' });

            const result = db.select().from(users).where(eq(users.name, 'testuser')).all();

            expect(result).toHaveLength(1);
            expect(result[0].id).toBe(user.id);
        });

        it('should validate PIN correctly', () => {
            const db = getTestDb();
            const user = createTestUser(db, { name: 'testuser', pin: '5678' });

            const result = db.select().from(users).where(eq(users.name, 'testuser')).all();

            expect(result[0].pin).toBe('5678');
            expect(result[0].pin).not.toBe('0000');
        });

        it('should return empty for non-existent user', () => {
            const db = getTestDb();
            createTestUser(db, { name: 'existinguser' });

            const result = db.select().from(users).where(eq(users.name, 'nonexistent')).all();

            expect(result).toHaveLength(0);
        });

        it('should reject login with wrong PIN', () => {
            const db = getTestDb();
            createTestUser(db, { name: 'testuser', pin: '1234' });

            const result = db.select().from(users).where(eq(users.name, 'testuser')).all();
            const isValidPin = result[0]?.pin === '9999';

            expect(isValidPin).toBe(false);
        });
    });

    describe('User Registration', () => {
        it('should create new user successfully', () => {
            const db = getTestDb();
            const userId = uuidv4();
            const newUser = {
                id: userId,
                name: 'newuser',
                pin: '4321',
            };

            db.insert(users).values(newUser).run();

            const result = db.select().from(users).where(eq(users.name, 'newuser')).all();
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('newuser');
            expect(result[0].pin).toBe('4321');
        });

        it('should detect duplicate username', () => {
            const db = getTestDb();
            createTestUser(db, { name: 'duplicateuser' });

            const existing = db.select().from(users).where(eq(users.name, 'duplicateuser')).all();

            expect(existing.length > 0).toBe(true);
        });

        it('should validate PIN is 4 digits', () => {
            const validPins = ['1234', '0000', '9999'];
            const invalidPins = ['123', '12345', 'abcd', ''];

            validPins.forEach(pin => {
                expect(pin.length === 4 && /^\d+$/.test(pin)).toBe(true);
            });

            invalidPins.forEach(pin => {
                expect(pin.length === 4 && /^\d+$/.test(pin)).toBe(false);
            });
        });
    });
});
