from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [  # noqa: RUF012
        ("home", "0017_alter_blog_category"),
    ]

    operations = [  # noqa: RUF012
        migrations.RenameField(
            model_name="blog",
            old_name="category",
            new_name="topic",
        ),
    ]
