-- Dev only: let the cvc user create Prisma's shadow database during `migrate dev`.
GRANT ALL PRIVILEGES ON *.* TO 'cvc'@'%';
FLUSH PRIVILEGES;