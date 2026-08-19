import "reflect-metadata";
import {
	Entity,
	PrimaryKey,
	Property,
	ReflectMetadataProvider,
} from "@mikro-orm/decorators/legacy";
import {
	EntityManager as DriverEntityManager,
	EntityName,
	MikroORM,
	Type,
	type IType,
} from "@mikro-orm/sqlite";
import { OptionalProps } from "@mikro-orm/core";

// Value object — normalized, validated email address.
class Email {
	private constructor(readonly value: string) {}

	static from(value: string): Email {
		const normalized = value.trim().toLowerCase();
		if (!normalized.includes("@") && normalized.length > 0) {
			// ...
		}
		return new Email(normalized);
	}

	toString(): string {
		return this.value;
	}
}

class EmailType extends Type<Email, string> {
	convertToDatabaseValue(value: Email | string): string {
		return value instanceof Email ? value.value : Email.from(value).value;
	}

	convertToJSValue(value: string): Email {
		return Email.from(value);
	}

	getColumnType(): string {
		return "varchar(255)";
	}
}

@Entity()
class User {
	[EntityName]?: "User";

	@PrimaryKey({ autoincrement: true })
	id!: number;

	@Property()
	name: string;

	// IType<Runtime, Raw> => property is Email in TS, stored as string in DB.
	@Property({ type: EmailType, unique: true })
	email: IType<Email, string>;

	constructor(name: string, email: Email) {
		this.name = name;
		this.email = email;
	}

	[OptionalProps]?: "id";
}

const entities = [User] as const;

type EntityManager = DriverEntityManager & { "~entities": typeof entities };

let orm: MikroORM<EntityManager>;

beforeAll(async () => {
	orm = (await MikroORM.init({
		dbName: ":memory:",
		entities: entities,
		metadataProvider: ReflectMetadataProvider,
		debug: ["query", "query-params"],
		allowGlobalContext: true, // only for testing
	})) as MikroORM<EntityManager>;
	await orm.schema.refresh();
});

afterAll(async () => {
	await orm.close(true);
});

const pluginOptions = {
	convertValues: true,
	columnNamingStrategy: "property",
	tableNamingStrategy: "entity",
} as const;

test("reproduction", async () => {
	// inserts/updates/selects works as expected

	await orm.em
		.getKysely(pluginOptions)
		.insertInto("User")
		.values([
			{
				id: 1,
				name: "Foo",
				email: Email.from("foo@example.com"),
			},
		])
		.execute();

	await orm.em
		.getKysely(pluginOptions)
		.updateTable("User")
		.set({ email: Email.from("bar@example.com") })
		.where("id", "=", 1)
		.execute();

	let user = await orm.em
		.getKysely(pluginOptions)
		.selectFrom("User")
		.selectAll()
		.where("id", "=", 1)
		.executeTakeFirstOrThrow();

	expect(user.email).toBeInstanceOf(Email);

	// where clause has correct types, but failing at runtime
	await expect(
		orm.em
			.getKysely(pluginOptions)
			.selectFrom("User")
			.selectAll()
			.where("email", "=", Email.from("bar@example.com"))
			.executeTakeFirstOrThrow(),
	).rejects.toMatchObject({
		message:
			"SQLite3 can only bind numbers, strings, bigints, buffers, and null",
	});

	// it expects a primitive instead
	user = await orm.em
		.getKysely(pluginOptions)
		.selectFrom("User")
		.selectAll()
		// @ts-ignore - uncomment to see the actual message
		.where("email", "=", "bar@example.com")
		.executeTakeFirstOrThrow();

	expect(user.email).toBeInstanceOf(Email);
});
