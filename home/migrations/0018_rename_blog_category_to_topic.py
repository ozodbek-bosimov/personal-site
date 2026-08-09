from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("home", "0017_alter_blog_category"),
    ]

    operations = [
        migrations.RenameField(
            model_name="blog",
            old_name="category",
            new_name="topic",
        ),
    ]
