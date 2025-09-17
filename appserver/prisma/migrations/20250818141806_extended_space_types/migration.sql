-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SpaceType" ADD VALUE 'DiningRoom';
ALTER TYPE "SpaceType" ADD VALUE 'Office';
ALTER TYPE "SpaceType" ADD VALUE 'Basement';
ALTER TYPE "SpaceType" ADD VALUE 'Attic';
ALTER TYPE "SpaceType" ADD VALUE 'Laundry';
ALTER TYPE "SpaceType" ADD VALUE 'Closet';
ALTER TYPE "SpaceType" ADD VALUE 'Pantry';
ALTER TYPE "SpaceType" ADD VALUE 'Mudroom';
ALTER TYPE "SpaceType" ADD VALUE 'Foyer';
ALTER TYPE "SpaceType" ADD VALUE 'Library';
ALTER TYPE "SpaceType" ADD VALUE 'GameRoom';
ALTER TYPE "SpaceType" ADD VALUE 'HomeTheater';
ALTER TYPE "SpaceType" ADD VALUE 'Gym';
ALTER TYPE "SpaceType" ADD VALUE 'Studio';
ALTER TYPE "SpaceType" ADD VALUE 'GuestRoom';
ALTER TYPE "SpaceType" ADD VALUE 'MasterBedroom';
ALTER TYPE "SpaceType" ADD VALUE 'Balcony';
ALTER TYPE "SpaceType" ADD VALUE 'Patio';
ALTER TYPE "SpaceType" ADD VALUE 'Deck';
ALTER TYPE "SpaceType" ADD VALUE 'Yard';
ALTER TYPE "SpaceType" ADD VALUE 'Driveway';
